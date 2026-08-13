#!/usr/bin/env bash
#
# Self-test for check-main-checked.sh, driven by a stub `gh`.
#
# Why this exists: pr.yml paths-ignores `scripts/**`, so a green PR proves nothing about this
# script — CI never runs it. And the script it tests is a BACKSTOP: in normal operation it
# prints "GREEN" forever, so nothing about day-to-day use would ever reveal that its failure
# arm is broken. A guard whose alarm has never been heard is indistinguishable from one that
# cannot sound. The live half of the proof (running the real script over commit 4727672f,
# which genuinely has zero check-suites) is in the PR body; this is the deterministic,
# offline half, and it is the one that runs on every change.
#
# What it pins is the CLASSIFICATION, which is the whole substance of the script: the four
# states it must tell apart are each asserted both ways — one fixture that must be reported
# and one that must not, differing only in the clause under test. A suite that only proved
# the alarm fires would prove "something changed", not "this defect is caught, and only this
# defect". The grace window in particular is a false-negative machine: a window that
# swallowed everything would pass any test that only checked the alarm can sound.
#
# What it does NOT pin: the stub answers from fixtures keyed on the request path, so a wrong
# `--jq` or a malformed query string would mostly still pass. Two cases (`GH_ARGV`) assert HOW
# the commit list was scoped, because a dropped `sha=` or `per_page=` is invisible otherwise
# and would silently check the wrong commits.
#
#   bash scripts/test-check-main-checked.sh
#
# The largest single group of cases is the THIRD outcome: could-not-determine. A backstop that
# degrades into a pass when it cannot reach the API is strictly worse than no backstop, because
# it manufactures the false confidence it exists to remove, and nobody re-runs a green. The
# natural implementation reads total_count and compares it to 0 — and a 401, a rate limit, a
# dropped connection, a malformed page and a response missing the field ALL look like 0 to it.
# So each of those is fed in separately and each must come back loud, with exit 2, and must
# never be spelled the same way as a genuine zero.
#
#   bash scripts/test-check-main-checked.sh
#
# Exit 0 = all cases pass. No network, deterministic, ~2s.
set -uo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
STUB="$(mktemp -d)"
trap 'rm -rf "$STUB"' EXIT
fails=0
FIX="$STUB/suites"; mkdir -p "$FIX"

cat >"$STUB/gh" <<'STUBEOF'
#!/usr/bin/env bash
# Two API shapes, dispatched on whether the path ends in /check-suites.
#
#   commit list   -> $GH_COMMITS
#   check-suites  -> $GH_FIX/<sha>.json, falling back to $GH_FIX/default.json
#
# `!FAIL <msg>` as the first line of either file makes that call exit non-zero, standing in
# for auth expiry / rate limit / no network. The full argv is appended to $GH_ARGV so a case
# can assert how the query was scoped, not merely what it returned.
[ -n "${GH_ARGV:-}" ] && printf '%s\n' "$*" >>"$GH_ARGV"
case "$1" in
  api) path="$2" ;;
  *) echo "stub gh: unhandled: $*" >&2; exit 1 ;;
esac
emit() {
  [ -f "$1" ] || { echo "stub gh: no fixture $1" >&2; exit 1; }
  read -r first <"$1" || true
  if [ "${first%% *}" = "!FAIL" ]; then echo "${first#!FAIL }" >&2; exit 1; fi
  cat "$1"
}
case "$path" in
  *"/check-suites"*)
    rest="${path#*/commits/}"; sha="${rest%%/*}"
    f="${GH_FIX:-/nonexistent}/$sha.json"
    [ -f "$f" ] || f="${GH_FIX:-/nonexistent}/default.json"
    emit "$f" ;;
  *"/commits"*)
    emit "${GH_COMMITS:-/nonexistent}" ;;
  *) echo "stub gh: unhandled api path: $path" >&2; exit 1 ;;
esac
STUBEOF
chmod +x "$STUB/gh"

# Timestamps are relative to now, so the grace window is exercised against the real clock
# rather than a date that ages into or out of the threshold. OLD is well past the 10m default;
# FRESH is well inside it.
OLD=$(date -u -d '-6 hours' +%Y-%m-%dT%H:%M:%SZ)
FRESH=$(date -u -d '-2 minutes' +%Y-%m-%dT%H:%M:%SZ)

# commit_list <"sha:subject:date"> ...
commit_list() {
  local out="" c
  for c in "$@"; do
    IFS=: read -r csha csub cdate <<<"$c"
    out="$out${out:+,}{\"sha\":\"$csha\",\"commit\":{\"message\":\"$csub\",\"committer\":{\"date\":\"$cdate\"}}}"
  done
  printf '[%s]\n' "$out" >"$STUB/commits.json"
}

# suites <sha> <"app:conclusion"> ...   — an empty list means total_count 0, the defect.
suites() {
  local sha="$1"; shift
  local out="" s n=0
  for s in "$@"; do
    IFS=: read -r sapp sconc <<<"$s"
    [[ "$sconc" == "null" ]] && sconc="null" || sconc="\"$sconc\""
    out="$out${out:+,}{\"app\":{\"slug\":\"$sapp\"},\"status\":\"completed\",\"conclusion\":$sconc}"
    n=$((n + 1))
  done
  printf '{"total_count":%d,"check_suites":[%s]}\n' "$n" "$out" >"$FIX/$sha.json"
}

report() {
  local name="$1" bad="$2" out="$3"
  if [[ -z "$bad" ]]; then
    echo "PASS  $name"
  else
    echo "FAIL  $name — ${bad#; }"; sed 's/^/        /' <<<"$out"; fails=1
  fi
}

# run_case <name> <expected-exit> <must-contain> <must-not-contain|-> [env assignments...]
run_case() {
  local name="$1" want="$2" yes="$3" no="$4"; shift 4
  local out rc bad=""
  out=$(env GH_COMMITS="$STUB/commits.json" GH_FIX="$FIX" PATH="$STUB:$PATH" "$@" \
        bash "$DIR/check-main-checked.sh" 5 testref 2>&1); rc=$?
  [[ "$rc" == "$want" ]] || bad="; exit $rc, wanted $want"
  grep -q -- "$yes" <<<"$out" || bad="$bad; missing '$yes'"
  [[ "$no" != "-" ]] && grep -q -- "$no" <<<"$out" && bad="$bad; must not say '$no'"
  report "$name" "$bad" "$out"
}

GA=github-actions
CR=coderabbitai

# ---------------------------------------------------------------------------------------
echo "check-main-checked.sh — the defect it exists to catch"

# The real shape, from main on 2026-08-13: 4727672f has total_count 0 across every app while
# the commits either side of it have suites from both apps. The stub reproduces exactly that.
build_real_shape() {
  commit_list \
    "aaaa1111:CHANGE-41 show which build is running:$OLD" \
    "bbbb2222:Scribe TI-81 archived and TI-88 filed:$OLD" \
    "4727672f:TI-81 discount an orphaned deploy run record:$OLD" \
    "cccc3333:TI-87 log the dependency-download blip:$OLD" \
    "dddd4444:TI-86 lift SSH.NET past the advisory:$OLD"
  suites aaaa1111 "$CR:null" "$GA:success"
  suites bbbb2222 "$CR:null" "$GA:success"
  suites 4727672f
  suites cccc3333 "$CR:null" "$GA:success"
  suites dddd4444 "$CR:null" "$GA:success"
}
build_real_shape

run_case "a commit with no suite from any app fails the run" 1 "UNCHECKED" -
run_case "  ...and it is named by sha"                       1 "4727672f" -
run_case "  ...and by subject, so it is identifiable"        1 "discount an orphaned deploy run record" -
run_case "  ...and the verdict says how many"                1 "1 of 5" -
# The other half. A backstop that reddens the whole window is a broken instrument that
# happens to be pointing the right way; the four controls must come back clean.
run_case "  ...and the surrounding commits are cleared"      1 "ok " -
run_case "  ...and no control is accused"                    1 "UNCHECKED" "UNCHECKED    aaaa1111"

# ---------------------------------------------------------------------------------------
echo "check-main-checked.sh — states that must NOT be reported as unchecked"

suites 4727672f "$CR:null" "$GA:success"
run_case "a fully-checked window is green" 0 "GREEN" "UNCHECKED"

# "A suite ran and failed" is somebody else problem — the deploy gate already shouts about it.
# This script claims one thing only: that something looked.
suites 4727672f "$CR:null" "$GA:failure"
run_case "a suite that RAN and FAILED is not unchecked" 0 "GREEN" "UNCHECKED"

# Measured on main 2026-08-13: 20 of the last 40 commits carry a coderabbit suite and NO
# github-actions suite, because deploy.yml paths-ignores docs/** and docs-check.yml only
# gained its push trigger at TI-80. Failing on those would put the alarm at a 50% false
# positive rate on real history, and an alarm that cries wolf every other commit is one
# nobody reads. Another app answering also PROVES the push event was delivered, which is the
# thing actually being reconciled here. So it is reported, and it does not fail.
suites 4727672f "$CR:null"
run_case "coderabbit-only is reported, not accused" 0 "no-actions" "UNCHECKED"
run_case "  ...and the run still passes"            0 "GREEN" -
# ...but the stricter bar is one env var away, for once TI-83 makes every push to main
# trigger a workflow. Asserted so the flag cannot rot into a no-op.
run_case "  ...unless the stricter bar is asked for" 1 "no-actions" - CHECK_MAIN_REQUIRE_ACTIONS=1

# ---------------------------------------------------------------------------------------
echo "check-main-checked.sh — the grace window (the false-positive risk)"

# A commit pushed seconds ago has no suite YET. Both directions are asserted: the window must
# excuse a fresh commit AND must not excuse an old one. Only the commit date differs between
# these two cases — the check-suites fixture is identical and empty in both.
commit_list "eeee5555:CHANGE-42 just pushed:$FRESH"
suites eeee5555
run_case "a commit pushed moments ago is not accused" 0 "too-recent" "UNCHECKED"

commit_list "eeee5555:CHANGE-42 pushed hours ago:$OLD"
run_case "  ...but the same commit hours later IS"    1 "UNCHECKED" "too-recent"

# The window must be stated, not silently applied — a threshold nobody can see is one nobody
# can judge, and this one is the difference between a false alarm and a missed one.
commit_list "eeee5555:CHANGE-42 just pushed:$FRESH"
run_case "  ...and the window is stated in the output" 0 "grace" -
# Shrinking the window must re-accuse the fresh commit. Without this, a window hard-coded to
# something enormous would pass every case above.
run_case "  ...and the window is really the threshold" 1 "UNCHECKED" - CHECK_MAIN_GRACE_MINUTES=1

# ---------------------------------------------------------------------------------------
# THE THIRD OUTCOME. Exit 2, never 0 and never 1.
#
# Every case below feeds the script something that a `total_count == 0` test would read as a
# genuine zero — or as nothing at all. The two assertions that matter are on every one of
# them: it must NOT say GREEN (a silent degrade into a pass), and it must NOT say UNCHECKED
# (an accusation manufactured out of an unanswered question). The distinct exit code is what
# lets a caller tell "main has a hole in it" from "I could not find out", which are opposite
# instructions: one is fix it, the other is run me again.
echo "check-main-checked.sh — could-not-determine is a THIRD outcome, not a pass"

# 1. A non-zero exit from gh: auth expiry, rate limit, no network.
build_real_shape
printf '!FAIL gh: HTTP 401 Bad credentials\n' >"$FIX/4727672f.json"
run_case "a failing check-suites call is unverifiable, not zero" 2 "unverifiable" "GREEN"
run_case "  ...and the error text is shown"                      2 "401 Bad credentials" -
run_case "  ...and it is never called unchecked"                 2 "unverifiable" "UNCHECKED"

# 2. A body that is not JSON at all — a proxy error page, a truncated response.
build_real_shape
printf '<html>502 Bad Gateway</html>\n' >"$FIX/4727672f.json"
run_case "a malformed body is unverifiable, not zero" 2 "unverifiable" "GREEN"
run_case "  ...and is never called unchecked"         2 "unverifiable" "UNCHECKED"

# 3. Valid JSON, but no total_count. This is the sharpest one: `.get("total_count") or 0` and
# `len(check_suites)` both read this as a genuine zero, and it is the shape an API error body
# actually has — {"message": "Not Found", ...} parses perfectly well.
build_real_shape
printf '{"message":"Not Found","documentation_url":"https://docs.github.com"}\n' >"$FIX/4727672f.json"
run_case "a response with no total_count is unverifiable" 2 "unverifiable" "GREEN"
run_case "  ...and is never called unchecked"             2 "unverifiable" "UNCHECKED"

# 4. total_count present but disagreeing with the array it describes — a paginated or
# truncated page. Reading either number alone cannot see it.
build_real_shape
printf '{"total_count":7,"check_suites":[]}\n' >"$FIX/4727672f.json"
run_case "a truncated page is unverifiable, not zero" 2 "unverifiable" "UNCHECKED"

# 5. A confirmed hole AND an unanswerable commit in the same window. The confirmed finding is
# the more actionable fact and decides the exit code, but the unanswered commit must still be
# disclosed — a window reported clean apart from the one hole, while silently having skipped
# a commit, is the same false confidence one level down.
build_real_shape
suites 4727672f
printf '!FAIL gh: HTTP 403 rate limit exceeded\n' >"$FIX/cccc3333.json"
run_case "a real hole outranks an unanswered commit" 1 "UNCHECKED" "GREEN"
run_case "  ...but the unanswered commit is still disclosed" 1 "unverifiable" -

# 6. The commit list itself. Nothing at all is established, so there is nothing to be green about.
build_real_shape
printf '!FAIL gh: HTTP 403 rate limit exceeded\n' >"$STUB/commits.json"
run_case "an unreadable commit list is unverifiable" 2 "could not" "GREEN"

printf 'not json at all\n' >"$STUB/commits.json"
run_case "an unparseable commit list is unverifiable" 2 "could not" "GREEN"

# 7. An empty commit list. A window covering no commits proves nothing, and "0 of 0 unchecked"
# is true and useless — exactly the shape that reads as an all-clear.
printf '[]\n' >"$STUB/commits.json"
run_case "an empty commit list is unverifiable" 2 "no commits" "GREEN"

# ---------------------------------------------------------------------------------------
echo "check-main-checked.sh — the query is scoped as asked"

# Every case above answers from fixtures keyed on the path, so the commit list could be
# fetched for the wrong branch, or 30 commits deep when 5 were asked for, and nothing would
# notice. These two read the actual argv.
build_real_shape
ARGV="$STUB/argv"; : >"$ARGV"
out=$(GH_COMMITS="$STUB/commits.json" GH_FIX="$FIX" GH_ARGV="$ARGV" PATH="$STUB:$PATH" \
      bash "$DIR/check-main-checked.sh" 5 testref 2>&1)
bad=""
grep -q 'sha=testref' "$ARGV" || bad="; the commit list was not scoped to the ref asked for"
grep -q 'per_page=5' "$ARGV" || bad="$bad; the commit list did not request the count asked for"
report "the commit list names the ref and the count" "$bad" "$(cat "$ARGV")"

# One call per commit, and no more: the runtime cost claimed in the PR body is N+1, and a
# script that quietly paged or retried would blow the rate-limit budget on a 50-commit window.
n_suites=$(grep -c 'check-suites' "$ARGV")
n_list=$(grep -vc 'check-suites' "$ARGV")
bad=""
[[ "$n_suites" == 5 ]] || bad="; made $n_suites check-suite calls for 5 commits, wanted 5"
[[ "$n_list" == 1 ]] || bad="$bad; made $n_list commit-list calls, wanted 1"
report "exactly one API call per commit, plus one for the list" "$bad" "$(cat "$ARGV")"

# ---------------------------------------------------------------------------------------
echo "check-main-checked.sh — portability"

# scripts/ lives on a Windows/WSL mount where the exec bit does not survive, so most of it is
# committed 100644. Anything invoked bare dies on a fresh clone.
NOEXEC="$(mktemp -d)"
noexec_bad=""
# The copy is asserted. Left unchecked, a missing script makes `cp` fail, `noexec_out` empty,
# and the grep below find nothing — reporting PASS having run nothing at all. Seen for real
# while this suite was still red.
if ! cp "$DIR/check-main-checked.sh" "$NOEXEC/" 2>/dev/null; then
  noexec_bad="check-main-checked.sh is missing, so nothing was exercised"
else
  chmod 644 "$NOEXEC"/*.sh
  noexec_out=$(GH_COMMITS="$STUB/commits.json" GH_FIX="$FIX" PATH="$STUB:$PATH" \
               bash "$NOEXEC/check-main-checked.sh" 5 testref 2>&1) || true
  grep -qi "permission denied" <<<"$noexec_out" \
    && noexec_bad="a sibling script is invoked directly"
  [[ -z "$noexec_out" ]] && noexec_bad="the script printed nothing, so nothing was exercised"
fi
rm -rf "$NOEXEC"
report "runs with the exec bit cleared" "$noexec_bad" "${noexec_out:-}"

# The same trap that bit deploy-status.sh: a single apostrophe inside the `python3 -c '...'`
# block closes the quote early and the script becomes unparseable shell.
py_bad=""
py_start=$(grep -n "python3 -c '" "$DIR/check-main-checked.sh" | head -1 | cut -d: -f1)
py_end=$(grep -n "^' 2>&1); then" "$DIR/check-main-checked.sh" | head -1 | cut -d: -f1)
if [[ -z "$py_start" || -z "$py_end" ]]; then
  py_bad="could not locate the python block delimiters"
else
  offenders=$(awk -v s="$py_start" -v e="$py_end" "NR>s && NR<e && /'/ {print NR\": \"\$0}" \
              "$DIR/check-main-checked.sh")
  [[ -n "$offenders" ]] && py_bad=$'an apostrophe inside the python3 -c block closes it early:\n'"$offenders"
fi
bash -n "$DIR/check-main-checked.sh" 2>/dev/null || py_bad="$py_bad; check-main-checked.sh does not parse"
report "no apostrophe inside the python3 -c block" "$py_bad" ""

echo "---"
if [[ "$fails" == 0 ]]; then echo "CHECK-MAIN-CHECKED SELF-TEST: GREEN"; else echo "CHECK-MAIN-CHECKED SELF-TEST: FAILED"; fi
exit "$fails"
