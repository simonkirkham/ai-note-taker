#!/usr/bin/env bash
#
# Full Pip merge gate for a PR, as one check. Confirms ALL of:
#   1. PR is MERGEABLE / CLEAN (not CONFLICTING — which runs head-only checks and
#      can falsely report green because the backend/frontend merge-result checks
#      never start)
#   2. Every PR CI check is `pass` (none pending/fail/cancelled)
#   3. main's latest deploy is GREEN with no deploy in progress (deploy-status.sh)
#
#   scripts/merge-gate.sh <pr-number>
#
# Exit 0 = all gates green, safe to `gh pr merge --squash --delete-branch`.
# Exit 1 = a gate failed; the offending line says which.
set -euo pipefail

PR="${1:?usage: merge-gate.sh <pr-number>}"
DIR="$(cd "$(dirname "$0")" && pwd)"
fail=0

# 1. Mergeable state.
read -r mergeable state <<<"$(gh pr view "$PR" --json mergeable,mergeStateStatus \
  -q '.mergeable + " " + .mergeStateStatus')"
if [[ "$mergeable" == "MERGEABLE" && "$state" == "CLEAN" ]]; then
  echo "MERGEABLE: ok ($state)"
else
  echo "MERGEABLE: FAIL (mergeable=$mergeable state=$state) — rebase/resolve conflicts"
  fail=1
fi

# 2. PR CI checks. Empty/near-empty list on a CONFLICTING branch is a trap, so we
# also require the merge-result checks to be present (guarded by gate 1).
checks=$(gh pr checks "$PR" 2>/dev/null || true)
if echo "$checks" | grep -qiE '\b(pending|fail|cancelled)\b'; then
  echo "PR CI: FAIL — not all checks pass:"
  echo "$checks" | grep -iE '\b(pending|fail|cancelled)\b' | sed 's/^/    /'
  fail=1
elif [[ -z "$checks" ]]; then
  echo "PR CI: FAIL — no checks reported (CONFLICTING head-only run?)"
  fail=1
else
  echo "PR CI: ok (all pass)"
fi

# 3. Main deploy.
if deploy=$("$DIR/deploy-status.sh"); then
  echo "MAIN DEPLOY: $deploy"
else
  echo "MAIN DEPLOY: $deploy"
  fail=1
fi

echo "---"
if [[ "$fail" == 0 ]]; then
  echo "MERGE GATE: GREEN — safe to merge PR #$PR"
else
  echo "MERGE GATE: BLOCKED — fix the FAIL line(s) above"
fi
exit "$fail"
