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
  *) echo "stub gh: unhandled: $*" >&2; exit 1 ;;
esac
STUBEOF
chmod +x "$STUB/gh"
printf '[{"number":999,"status":"completed","conclusion":"success","createdAt":"2026-08-11T00:00:00Z"}]\n' >"$STUB/runs.json"

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
  out=$(GH_SEQ="$STUB/seq" GH_CALLS="$STUB/calls" GH_RUNS="$STUB/runs.json" \
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
  out=$(GH_RUNS="$STUB/runs2.json" PATH="$STUB:$PATH" bash "$DIR/deploy-status.sh" 2>&1); rc=$?
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
run_deploy "in-progress waits"   1 "IN PROGRESS" -                 '[{"number":9,"status":"in_progress","conclusion":null}]'
run_deploy "waiting-for-approval is not a broken main" \
                                 1 "IN PROGRESS" "fix main first"  '[{"number":9,"status":"waiting","conclusion":null}]'
run_deploy "failed main"         1 "did not succeed" -             '[{"number":9,"status":"completed","conclusion":"failure"}]'
run_deploy "cancelled is not a broken main" \
                                 1 "cancelled, not failed" "fix main first" \
                                                                   '[{"number":9,"status":"completed","conclusion":"cancelled"}]'
run_deploy "unknown conclusion names no cause" \
                                 1 "no cause established" "fix main first" \
                                                                   '[{"number":9,"status":"completed","conclusion":"action_required"}]'
run_deploy "no runs at all"      1 "no runs found" "Traceback"     '[]'

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
