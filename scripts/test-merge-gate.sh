#!/usr/bin/env bash
#
# Self-test for merge-gate.sh gate 1 and deploy-status.sh, driven by a stub `gh`.
#
# Why this exists: pr.yml paths-ignores `scripts/**`, so a green PR proves nothing about
# these scripts — CI never runs them. TI-77 (merge-gate.sh reporting GitHub's still-computing
# UNKNOWN as a conflict, and telling you to rebase a clean branch) shipped and survived
# precisely because nothing exercised the failure branches. Wired into docs-check.yml, which
# already exists to gate the paths pr.yml ignores.
#
# What it pins is the SHAPE of the messages, not just the exit codes: each condition must be
# reported as what was observed, and the rebase remedy must belong to CONFLICTING alone.
#
# What it does NOT pin: the stub ignores `gh`'s arguments, so a wrong --json field or a
# swapped `-q` field order would still pass here. This tests the branching, not the query.
#
#   bash scripts/test-merge-gate.sh
#
# Exit 0 = all cases pass. Takes ~15s (the UNKNOWN cases wait out the real retry budget).
set -uo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
STUB="$(mktemp -d)"
trap 'rm -rf "$STUB"' EXIT
fails=0

cat >"$STUB/gh" <<'STUBEOF'
#!/usr/bin/env bash
# `pr view` replays one line of $GH_SEQ per call, sticking on the last line once exhausted,
# and counts its calls into $GH_CALLS. The line `!FAIL <msg>` makes the call exit non-zero,
# standing in for auth expiry / rate limit / no network. The other subcommands answer green
# so that gate 1 is the only thing under test.
case "$1 $2" in
  "pr view")
    n=$(( $(cat "$GH_CALLS") + 1 )); echo "$n" >"$GH_CALLS"
    line=$(sed -n "${n}p" "$GH_SEQ"); [ -z "$line" ] && line=$(tail -n1 "$GH_SEQ")
    if [ "${line%% *}" = "!FAIL" ]; then echo "${line#!FAIL }" >&2; exit 1; fi
    echo "$line" ;;
  "pr checks")
    printf 'backend\tpass\t1m\thttps://x\nfrontend\tpass\t1m\thttps://x\n' ;;
  "run list")
    # `!FAIL <msg>` in the runs file makes the call exit non-zero, standing in for auth
    # expiry / rate limit / no network on the deploy query.
    read -r first <"${GH_RUNS:-/dev/null}" || true
    if [ "${first%% *}" = "!FAIL" ]; then echo "${first#!FAIL }" >&2; exit 1; fi
    cat "${GH_RUNS:-/dev/null}" ;;
  "api "*)
    # TI-81: the per-run jobs and pending_deployments lookups. Answers from
    # $GH_API_DIR/<runid>.<jobs|pending>.json, falling back to default.<...>.json so a case
    # that does not care about one of them still gets a definite answer rather than an error.
    # `!FAIL <msg>` works here too, standing in for an unreachable API mid-decision.
    path="$2"; rid="${path#*/actions/runs/}"; what="${rid#*/}"; rid="${rid%%/*}"
    case "$what" in
      jobs) kind=jobs ;;
      pending_deployments) kind=pending ;;
      *) echo "stub gh: unhandled api path: $path" >&2; exit 1 ;;
    esac
    f="${GH_API_DIR:-/nonexistent}/$rid.$kind.json"
    [ -f "$f" ] || f="${GH_API_DIR:-/nonexistent}/default.$kind.json"
    if [ ! -f "$f" ]; then echo "stub gh: no fixture for $path" >&2; exit 1; fi
    read -r first <"$f" || true
    if [ "${first%% *}" = "!FAIL" ]; then echo "${first#!FAIL }" >&2; exit 1; fi
    cat "$f" ;;
  *) echo "stub gh: unhandled: $*" >&2; exit 1 ;;
esac
STUBEOF
chmod +x "$STUB/gh"
printf '[{"number":999,"status":"completed","conclusion":"success","createdAt":"2026-08-11T00:00:00Z"}]\n' >"$STUB/runs.json"

# TI-81 fixtures. The default answers say "a job is still running", so any not-finished run a
# case does not explicitly describe blocks — the conservative direction, and it keeps a case
# that forgets a fixture from silently passing through the discount path.
API="$STUB/api"; mkdir -p "$API"
printf '{"jobs":[{"name":"deploy-test","status":"in_progress","conclusion":null}]}\n' >"$API/default.jobs.json"
printf '[]\n' >"$API/default.pending.json"

# Timestamps are relative to now, so the staleness clause is exercised against the real clock
# rather than a date that ages into or out of the threshold. STALE is well past the 10m bar
# (#762 was 73m); FRESH is well inside it.
STALE=$(date -u -d '-45 minutes' +%Y-%m-%dT%H:%M:%SZ)
FRESH=$(date -u -d '-2 minutes' +%Y-%m-%dT%H:%M:%SZ)

# jobs_fixture <runid> <"name:status:conclusion" ...>
jobs_fixture() {
  local rid="$1"; shift
  local out="" j
  for j in "$@"; do
    IFS=: read -r jn js jc <<<"$j"
    [[ "$jc" == "null" ]] && jc="null" || jc="\"$jc\""
    out="$out${out:+,}{\"name\":\"$jn\",\"status\":\"$js\",\"conclusion\":$jc}"
  done
  printf '{"jobs":[%s]}\n' "$out" >"$API/$rid.jobs.json"
}
pending_fixture() { printf '%s\n' "$2" >"$API/$1.pending.json"; }

# The five-job success shape #762 actually had.
five_green() { jobs_fixture "$1" \
  detect-changes:completed:success validate-frontend:completed:success \
  validate-backend:completed:success deploy-test:completed:success \
  deploy-production:completed:success; }

report() {
  local name="$1" bad="$2" out="$3" extra="${4:-}"
  if [[ -z "$bad" ]]; then
    echo "PASS  $name  $extra"
  else
    echo "FAIL  $name — ${bad#; }"; sed 's/^/        /' <<<"$out"; fails=1
  fi
}

# run_gate <name> <expected-exit> <must-contain> <must-not-contain|-> <mergeable-line>...
run_gate() {
  local name="$1" want="$2" yes="$3" no="$4"; shift 4
  printf '%s\n' "$@" >"$STUB/seq"; echo 0 >"$STUB/calls"
  local out rc bad=""
  out=$(GH_SEQ="$STUB/seq" GH_CALLS="$STUB/calls" GH_RUNS="$STUB/runs.json" GH_API_DIR="$API" \
        PATH="$STUB:$PATH" bash "$DIR/merge-gate.sh" 460 2>&1); rc=$?
  [[ "$rc" == "$want" ]] || bad="; exit $rc, wanted $want"
  grep -q -- "$yes" <<<"$out" || bad="$bad; missing '$yes'"
  [[ "$no" != "-" ]] && grep -q -- "$no" <<<"$out" && bad="$bad; must not say '$no'"
  report "$name" "$bad" "$out" "(polls=$(cat "$STUB/calls"))"
}

# run_deploy <name> <expected-exit> <must-contain> <must-not-contain|-> <runs-json>
run_deploy() {
  local name="$1" want="$2" yes="$3" no="$4" json="$5"
  printf '%s\n' "$json" >"$STUB/runs2.json"
  local out rc bad=""
  out=$(GH_RUNS="$STUB/runs2.json" GH_API_DIR="$API" PATH="$STUB:$PATH" \
        bash "$DIR/deploy-status.sh" 2>&1); rc=$?
  [[ "$rc" == "$want" ]] || bad="; exit $rc, wanted $want"
  grep -q -- "$yes" <<<"$out" || bad="$bad; missing '$yes'"
  [[ "$no" != "-" ]] && grep -q -- "$no" <<<"$out" && bad="$bad; must not say '$no'"
  report "$name" "$bad" "$out"
}

echo "merge-gate.sh — gate 1"
run_gate "clean PR passes"                     0 "MERGEABLE: ok"          -          "MERGEABLE CLEAN"
run_gate "CONFLICTING still says rebase"       1 "rebase/resolve"         -          "CONFLICTING DIRTY"
run_gate "UNKNOWN settling is not a failure"   0 "MERGEABLE: ok"          "rebase"   "UNKNOWN UNKNOWN" "UNKNOWN UNKNOWN" "MERGEABLE CLEAN"
run_gate "UNKNOWN state alone also retries"    0 "MERGEABLE: ok"          "rebase"   "MERGEABLE UNKNOWN" "MERGEABLE CLEAN"
run_gate "UNKNOWN throughout names no cause"   1 "not finished computing" "rebase"   "UNKNOWN UNKNOWN"
run_gate "UNSTABLE names the failing check"    1 "not passing"            "unrecog"  "MERGEABLE UNSTABLE"
run_gate "BEHIND says update the branch"       1 "behind base"            "unrecog"  "MERGEABLE BEHIND"
run_gate "DRAFT says mark it ready"            1 "is a draft"             "unrecog"  "MERGEABLE DRAFT"
run_gate "unexpected state reports raw values" 1 "unrecognised"           "rebase"   "MERGEABLE WEIRD_NEW_STATE"
run_gate "a failing gh is named as such"       1 "could not query GitHub" "unrecog"  "!FAIL gh: HTTP 401 Bad credentials"

echo "deploy-status.sh"
run_deploy "green main"          0 "GREEN"       -                 '[{"number":9,"status":"completed","conclusion":"success"}]'
run_deploy "in-progress waits"   1 "IN PROGRESS" "discounted"      "[{\"number\":9,\"databaseId\":9,\"status\":\"in_progress\",\"conclusion\":null,\"updatedAt\":\"$FRESH\"}]"
printf '{"jobs":[]}\n' >"$API/8.jobs.json"
run_deploy "waiting-for-approval is not a broken main" \
                                 1 "IN PROGRESS" "fix main first"  "[{\"number\":8,\"databaseId\":8,\"status\":\"waiting\",\"conclusion\":null,\"updatedAt\":\"$FRESH\"}]"
run_deploy "failed main"         1 "did not succeed" -             '[{"number":9,"status":"completed","conclusion":"failure"}]'
run_deploy "cancelled is not a broken main" \
                                 1 "cancelled, not failed" "fix main first" \
                                                                   '[{"number":9,"status":"completed","conclusion":"cancelled"}]'
run_deploy "unknown conclusion names no cause" \
                                 1 "no cause established" "fix main first" \
                                                                   '[{"number":9,"status":"completed","conclusion":"action_required"}]'
run_deploy "no runs at all"      1 "no runs found" "Traceback"     '[]'

# TI-81. The orphaned-run-record exception to quiescence, and — more importantly — every
# shape that must NOT take it. Deploy #762 (2026-08-11) held the gate red for ~73 minutes
# with all five jobs completed+success and its own record frozen at a timestamp 59 seconds
# EARLIER than its last job finished.
#
# The cases below are paired on purpose: for each clause, one run that satisfies it and one
# that does not, differing in that clause alone. A suite that only proves the discount fires
# proves "something changed", not "this defect is caught" — and the guard cases are the half
# that stops the exception from eating the quiescence rule it is carved out of.
echo "deploy-status.sh — TI-81 orphaned run records"

five_green 762
pending_fixture 762 '[]'
ORPHAN_762="{\"number\":762,\"databaseId\":762,\"status\":\"in_progress\",\"conclusion\":null,\"updatedAt\":\"$STALE\"},{\"number\":763,\"databaseId\":763,\"status\":\"completed\",\"conclusion\":\"success\",\"updatedAt\":\"$FRESH\"}"

run_deploy "an orphaned record is discounted, and said so" \
                                 0 "orphaned" -   "[$ORPHAN_762]"
run_deploy "  ...and the verdict names the live run" \
                                 0 "GREEN (#763)" -   "[$ORPHAN_762]"
run_deploy "  ...and the message names all three clauses, not just the one that tripped" \
                                 0 "no deployments awaiting approval" - "[$ORPHAN_762]"
run_deploy "  ...and the discount is never silent" \
                                 0 "discounted" -   "[$ORPHAN_762]"

# THE regression that matters most: the quiescence rule exists because a completed+success run
# can be re-run, flipping back to in_progress, so a --limit 1 poll can catch a transient green.
# A genuinely re-running run differs from #762 in every clause, and must still block.
jobs_fixture 770 detect-changes:completed:success deploy-test:in_progress:null
pending_fixture 770 '[]'
run_deploy "a genuinely re-running run still blocks (quiescence survives)" \
                                 1 "IN PROGRESS" "orphaned" \
  "[{\"number\":770,\"databaseId\":770,\"status\":\"in_progress\",\"conclusion\":null,\"updatedAt\":\"$FRESH\"}]"
run_deploy "  ...and it says which job is still running" \
                                 1 "deploy-test status=in_progress" "discounted" \
  "[{\"number\":770,\"databaseId\":770,\"status\":\"in_progress\",\"conclusion\":null,\"updatedAt\":\"$FRESH\"}]"

# Clause 3's own red test: identical to #762 in every way except a fresh record.
five_green 771
pending_fixture 771 '[]'
run_deploy "a fresh record is not orphaned, however finished its jobs look" \
                                 1 "under the 10m threshold" "orphaned" \
  "[{\"number\":771,\"databaseId\":771,\"status\":\"in_progress\",\"conclusion\":null,\"updatedAt\":\"$FRESH\"}]"

# Clause 2's own red test. Latent today — no protection rules are configured, so
# pending_deployments is [] on every real run — which is exactly why it needs a test and not
# a comment. deploy.yml declares `environment:` on deploy-test and deploy-production, so the
# day either gains a required reviewer, a run can sit awaiting approval with every CREATED
# job finished and its record going stale: clauses 1 and 3 both hold while the deploy is live.
five_green 772
pending_fixture 772 '[{"environment":{"name":"production"},"current_user_can_approve":true}]'
run_deploy "a run awaiting deployment approval is not orphaned" \
                                 1 "await approval" "orphaned" \
  "[{\"number\":772,\"databaseId\":772,\"status\":\"in_progress\",\"conclusion\":null,\"updatedAt\":\"$STALE\"}]"

# Clause 1's own red test, and the worst outcome this fix could have had: `terminal` admits
# `failure`, so a stale run whose deploy-production FAILED would have been discounted and the
# gate would have reported GREEN — waving a merge onto a broken main.
jobs_fixture 773 detect-changes:completed:success validate-frontend:completed:success \
  validate-backend:completed:success deploy-test:completed:success \
  deploy-production:completed:failure
pending_fixture 773 '[]'
run_deploy "a failed job is never discounted, however stale the record" \
                                 1 "NOT SAFE" "orphaned" \
  "[{\"number\":773,\"databaseId\":773,\"status\":\"in_progress\",\"conclusion\":null,\"updatedAt\":\"$STALE\"}]"
run_deploy "  ...and the failing job is named" \
                                 1 "deploy-production status=completed conclusion=failure" "GREEN" \
  "[{\"number\":773,\"databaseId\":773,\"status\":\"in_progress\",\"conclusion\":null,\"updatedAt\":\"$STALE\"}]"

# The allow-list's own test: `skipped` is neither a failure nor the named safe state, so it
# must fall through and block rather than being swept into either bucket. This is the property
# that makes the form fail CLOSED on a conclusion nobody anticipated.
jobs_fixture 774 detect-changes:completed:success deploy-production:completed:skipped
pending_fixture 774 '[]'
run_deploy "a conclusion outside the allow-list blocks rather than being guessed at" \
                                 1 "conclusion=skipped" "orphaned" \
  "[{\"number\":774,\"databaseId\":774,\"status\":\"in_progress\",\"conclusion\":null,\"updatedAt\":\"$STALE\"}]"

# A run status this script has never seen must also fail closed, and print what it saw.
five_green 775
pending_fixture 775 '[]'
jobs_fixture 775 detect-changes:some_future_state:null
run_deploy "an unrecognised run status blocks and prints the raw values" \
                                 1 "status=warping_in" "orphaned" \
  "[{\"number\":775,\"databaseId\":775,\"status\":\"warping_in\",\"conclusion\":null,\"updatedAt\":\"$STALE\"}]"

# An API that cannot be reached mid-decision must make the gate MORE conservative, never less.
printf '!FAIL gh: HTTP 503 upstream\n' >"$API/776.jobs.json"
run_deploy "an unreadable jobs API blocks, and names itself" \
                                 1 "could not read its jobs" "orphaned" \
  "[{\"number\":776,\"databaseId\":776,\"status\":\"in_progress\",\"conclusion\":null,\"updatedAt\":\"$STALE\"}]"

five_green 777
printf '!FAIL gh: HTTP 503 upstream\n' >"$API/777.pending.json"
run_deploy "an unreadable pending-deployments API blocks too" \
                                 1 "could not read its pending deployments" "orphaned" \
  "[{\"number\":777,\"databaseId\":777,\"status\":\"in_progress\",\"conclusion\":null,\"updatedAt\":\"$STALE\"}]"

# A window in which EVERY run was discounted establishes nothing about main, so it must not
# fall through to a green — there is no live run left to read a conclusion off.
five_green 778
pending_fixture 778 '[]'
run_deploy "discounting the whole window establishes nothing, not a green" \
                                 1 "nothing is established" - \
  "[{\"number\":778,\"databaseId\":778,\"status\":\"in_progress\",\"conclusion\":null,\"updatedAt\":\"$STALE\"}]"

# merge-gate.sh shells out to deploy-status.sh, so it should inherit all of the above for
# free — "should" being the word this repo has been burned by. Check it, do not assume it.
echo "merge-gate.sh — TI-81 inheritance"
printf 'MERGEABLE CLEAN\n' >"$STUB/seq"; echo 0 >"$STUB/calls"
printf '[%s]\n' "$ORPHAN_762" >"$STUB/runs-orphan.json"
mg=$(GH_SEQ="$STUB/seq" GH_CALLS="$STUB/calls" GH_RUNS="$STUB/runs-orphan.json" GH_API_DIR="$API" \
     PATH="$STUB:$PATH" bash "$DIR/merge-gate.sh" 460 2>&1) && mgrc=0 || mgrc=$?
mgbad=""
[[ "$mgrc" == 0 ]] || mgbad="exit $mgrc, wanted 0 — the orphaned record still blocks the caller"
grep -q "MERGE GATE: GREEN" <<<"$mg" || mgbad="$mgbad; caller did not go green"
grep -qE '^MAIN DEPLOY: .*discounted' <<<"$mg" || mgbad="$mgbad; the discount did not survive the relay onto the MAIN DEPLOY line"
[[ "$(grep -c . <<<"$mg")" == 5 ]] || mgbad="$mgbad; verdict is not one line — gate 3 relays it inline, so a second line arrives stripped of its prefix"
report "the caller inherits the discount, on one line" "$mgbad" "$mg"

# gate 3 must never print a blank verdict: an unreachable GitHub, a missing python3 or an
# unreadable sibling all used to blank the line while still blocking the merge, telling you
# to fix a FAIL that was not on screen.
run_deploy "an unreachable GitHub is named, not blank" \
                                 1 "could not query GitHub" -        '!FAIL gh: HTTP 401 Bad credentials'
run_deploy "an unparseable run list is named, not blank" \
                                 1 "could not read the run list" -   'not json at all'

# Same failure seen through the caller: gate 3 must carry the reason, never an empty line.
echo "merge-gate.sh — gate 3"
printf 'MERGEABLE CLEAN\n' >"$STUB/seq"; echo 0 >"$STUB/calls"
printf '!FAIL gh: HTTP 401 Bad credentials\n' >"$STUB/runs-fail.json"
g3=$(GH_SEQ="$STUB/seq" GH_CALLS="$STUB/calls" GH_RUNS="$STUB/runs-fail.json" \
     PATH="$STUB:$PATH" bash "$DIR/merge-gate.sh" 460 2>&1) && g3rc=0 || g3rc=$?
g3bad=""
[[ "$g3rc" == 1 ]] || g3bad="exit $g3rc, wanted 1 — the gate must BLOCK, not just print"
grep -qE '^MAIN DEPLOY: *$' <<<"$g3" && g3bad="$g3bad; blank MAIN DEPLOY line"
grep -q "could not query GitHub" <<<"$g3" || g3bad="$g3bad; reason not carried to the caller"
report "gate 3 never blocks on a blank verdict" "$g3bad" "$g3"

# The case above only proves deploy-status.sh's own guards: they make it print something, so
# it passes with or without the caller's stand-in. This one exercises the stand-in itself —
# a sibling that dies having printed nothing, which is any abort path the guards don't cover.
SILENT="$(mktemp -d)"
cp "$DIR/merge-gate.sh" "$SILENT/"
printf '#!/usr/bin/env bash\nexit 3\n' >"$SILENT/deploy-status.sh"
printf 'MERGEABLE CLEAN\n' >"$STUB/seq"; echo 0 >"$STUB/calls"
g3s=$(GH_SEQ="$STUB/seq" GH_CALLS="$STUB/calls" GH_RUNS="$STUB/runs.json" \
      PATH="$STUB:$PATH" bash "$SILENT/merge-gate.sh" 460 2>&1) && g3srate=0 || g3srate=$?
rm -rf "$SILENT"
g3sbad=""
[[ "$g3srate" == 1 ]] || g3sbad="exit $g3srate, wanted 1 — the gate must BLOCK, not just print"
grep -qE '^MAIN DEPLOY: *$' <<<"$g3s" && g3sbad="$g3sbad; blank MAIN DEPLOY line"
grep -q "without printing a verdict" <<<"$g3s" || g3sbad="$g3sbad; no stand-in for the silent failure"
report "a silent sibling failure still names itself" "$g3sbad" "$g3s"

# And the same sibling exiting 0 silently: an empty verdict establishes nothing, so the gate
# must not read "no output" as "main is fine".
SILENT0="$(mktemp -d)"
cp "$DIR/merge-gate.sh" "$SILENT0/"
printf '#!/usr/bin/env bash\nexit 0\n' >"$SILENT0/deploy-status.sh"
printf 'MERGEABLE CLEAN\n' >"$STUB/seq"; echo 0 >"$STUB/calls"
g3z=$(GH_SEQ="$STUB/seq" GH_CALLS="$STUB/calls" GH_RUNS="$STUB/runs.json" \
      PATH="$STUB:$PATH" bash "$SILENT0/merge-gate.sh" 460 2>&1) && g3zrc=0 || g3zrc=$?
rm -rf "$SILENT0"
g3zbad=""
[[ "$g3zrc" == 1 ]] || g3zbad="exit $g3zrc, wanted 1 — a blank verdict must never read as GREEN"
grep -q "MERGE GATE: GREEN" <<<"$g3z" && g3zbad="$g3zbad; reported GREEN having read nothing"
report "a silent success is not a green main" "$g3zbad" "$g3z"

# scripts/ is committed 100644 (the Windows mount does not carry the exec bit), so a script
# calling a sibling must go through `bash`. Executing it directly passes on the author's
# drvfs mount, where every file reports executable, and dies with "Permission denied" on any
# Linux checkout — which the cases above cannot see locally, because they run on that mount.
#
# Reproduce the checkout rather than pattern-matching the source: copy both scripts somewhere
# with the exec bit genuinely cleared and run one through. That catches every spelling of a
# direct invocation, in either file, instead of the one spelling a regex happens to know.
echo "portability (scripts committed 100644)"
NOEXEC="$(mktemp -d)"
cp "$DIR/merge-gate.sh" "$DIR/deploy-status.sh" "$NOEXEC/"
chmod 644 "$NOEXEC"/*.sh
printf 'MERGEABLE CLEAN\n' >"$STUB/seq"; echo 0 >"$STUB/calls"
noexec_out=$(GH_SEQ="$STUB/seq" GH_CALLS="$STUB/calls" GH_RUNS="$STUB/runs.json" \
             PATH="$STUB:$PATH" bash "$NOEXEC/merge-gate.sh" 460 2>&1) || true
rm -rf "$NOEXEC"
if grep -qi "permission denied" <<<"$noexec_out"; then
  echo "FAIL  a sibling script is invoked directly — dies on any checkout without the exec bit"
  sed 's/^/        /' <<<"$noexec_out"; fails=1
else
  echo "PASS  runs with the exec bit cleared"
fi

echo "---"
if [[ "$fails" == 0 ]]; then echo "MERGE-GATE SELF-TEST: GREEN"; else echo "MERGE-GATE SELF-TEST: FAILED"; fi
exit "$fails"
