#!/usr/bin/env bash
#
# Self-test for merge-gate.sh gate 1 and deploy-status.sh, driven by a stub `gh`.
#
# Why this exists: pr.yml paths-ignores `scripts/**`, so a green PR proves nothing about
# these scripts — CI never runs them. TI-77 (merge-gate.sh reporting GitHub's still-computing
# UNKNOWN as a conflict, and telling you to rebase a clean branch) shipped and survived
# precisely because nothing exercised the failure branches.
#
# What it pins is the SHAPE of the messages, not just the exit codes: each condition must be
# reported as what was observed, and the rebase remedy must belong to CONFLICTING alone.
#
#   scripts/test-merge-gate.sh
#
# Exit 0 = all cases pass. Takes ~12s (the UNKNOWN case waits out the real retry budget).
set -uo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
STUB="$(mktemp -d)"
trap 'rm -rf "$STUB"' EXIT
fails=0

cat >"$STUB/gh" <<'STUBEOF'
#!/usr/bin/env bash
# `pr view` replays one line of $GH_SEQ per call, sticking on the last line once exhausted,
# and counts its calls into $GH_CALLS. The other subcommands answer green so that gate 1 is
# the only thing under test.
case "$1 $2" in
  "pr view")
    n=$(( $(cat "$GH_CALLS") + 1 )); echo "$n" >"$GH_CALLS"
    line=$(sed -n "${n}p" "$GH_SEQ"); [ -z "$line" ] && line=$(tail -n1 "$GH_SEQ")
    echo "$line" ;;
  "pr checks")
    printf 'backend\tpass\t1m\thttps://x\nfrontend\tpass\t1m\thttps://x\n' ;;
  "run list")
    cat "${GH_RUNS:-/dev/null}" ;;
  *) echo "stub gh: unhandled: $*" >&2; exit 1 ;;
esac
STUBEOF
chmod +x "$STUB/gh"
printf '[{"number":999,"status":"completed","conclusion":"success","createdAt":"2026-08-11T00:00:00Z"}]\n' >"$STUB/runs.json"

# run_gate <name> <expected-exit> <must-contain> <must-not-contain|-> <mergeable-line>...
run_gate() {
  local name="$1" want="$2" yes="$3" no="$4"; shift 4
  printf '%s\n' "$@" >"$STUB/seq"; echo 0 >"$STUB/calls"
  local out rc
  out=$(GH_SEQ="$STUB/seq" GH_CALLS="$STUB/calls" GH_RUNS="$STUB/runs.json" \
        PATH="$STUB:$PATH" bash "$DIR/merge-gate.sh" 460 2>&1); rc=$?
  local bad=""
  [[ "$rc" == "$want" ]] || bad="exit $rc, wanted $want"
  grep -q -- "$yes" <<<"$out" || bad="$bad; missing '$yes'"
  [[ "$no" != "-" ]] && grep -q -- "$no" <<<"$out" && bad="$bad; must not say '$no'"
  if [[ -z "$bad" ]]; then
    echo "PASS  $name  (polls=$(cat "$STUB/calls"))"
  else
    echo "FAIL  $name — $bad"; sed 's/^/        /' <<<"$out"; fails=1
  fi
}

# run_deploy <name> <expected-exit> <must-contain> <runs-json>
run_deploy() {
  local name="$1" want="$2" yes="$3" json="$4"
  printf '%s\n' "$json" >"$STUB/runs2.json"
  local out rc
  out=$(GH_RUNS="$STUB/runs2.json" PATH="$STUB:$PATH" bash "$DIR/deploy-status.sh" 2>&1); rc=$?
  if [[ "$rc" == "$want" ]] && grep -q -- "$yes" <<<"$out"; then
    echo "PASS  $name"
  else
    echo "FAIL  $name — exit $rc (wanted $want): $out"; fails=1
  fi
}

echo "merge-gate.sh — gate 1"
run_gate "clean PR passes"                     0 "MERGEABLE: ok"          -          "MERGEABLE CLEAN"
run_gate "CONFLICTING still says rebase"       1 "rebase/resolve"         -          "CONFLICTING DIRTY"
run_gate "UNKNOWN settling is not a failure"   0 "MERGEABLE: ok"          "rebase"   "UNKNOWN UNKNOWN" "UNKNOWN UNKNOWN" "MERGEABLE CLEAN"
run_gate "UNKNOWN throughout names no cause"   1 "not finished computing" "rebase"   "UNKNOWN UNKNOWN"
run_gate "unexpected state reports raw values" 1 "unrecognised"           "rebase"   "MERGEABLE BLOCKED"

echo "deploy-status.sh"
run_deploy "green main"          0 "GREEN"       '[{"number":9,"status":"completed","conclusion":"success"}]'
run_deploy "in-progress waits"   1 "IN PROGRESS" '[{"number":9,"status":"in_progress","conclusion":null}]'
run_deploy "waiting-for-approval is not a broken main" \
                                 1 "IN PROGRESS" '[{"number":9,"status":"waiting","conclusion":null}]'
run_deploy "failed main"         1 "did not succeed" '[{"number":9,"status":"completed","conclusion":"failure"}]'

echo "---"
if [[ "$fails" == 0 ]]; then echo "MERGE-GATE SELF-TEST: GREEN"; else echo "MERGE-GATE SELF-TEST: FAILED"; fi
exit "$fails"
