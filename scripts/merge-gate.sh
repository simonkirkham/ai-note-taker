#!/usr/bin/env bash
#
# Full Pip merge gate for a PR, as one check. Confirms ALL of:
#   1. PR is MERGEABLE / CLEAN (not CONFLICTING — which runs head-only checks and
#      can falsely report green because the backend/frontend merge-result checks
#      never start). Re-polled while GitHub still answers UNKNOWN, which it does for
#      up to a minute after main moves and which is not a conflict — see gate 1.
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
#
# GitHub computes mergeability on demand, so for up to a minute after main moves it
# answers UNKNOWN/UNKNOWN — neither a conflict nor an error, just not-yet-known. Reading
# it once and calling everything non-CLEAN a conflict sent PR #460 (2026-08-11) to a
# pointless rebase on a branch that was clean; re-polling returned MERGEABLE/CLEAN three
# times out of three, ~8s apart (TI-77). So: re-poll before concluding anything, and
# report what was SEEN rather than a cause — the rebase remedy belongs to CONFLICTING and
# to nothing else.
#
# 5 attempts × 2s = up to 8s of waiting, covering the observed recompute window. The loop
# exits the moment a definite answer arrives, so a settled PR pays one call as before.
MERGEABILITY_ATTEMPTS=5
MERGEABILITY_DELAY=2

mergeable=""
state=""
query_error=""
for ((attempt = 1; attempt <= MERGEABILITY_ATTEMPTS; attempt++)); do
  # `read a b <<<"$(cmd)"` discards cmd's exit status, so an auth expiry, a rate limit or
  # a bad PR number would arrive as two empty strings and be reported as an unrecognised
  # state. Capture the status: "GitHub could not be queried" is establishable, and blank
  # values are indistinguishable from a genuinely odd state.
  if ! raw=$(gh pr view "$PR" --json mergeable,mergeStateStatus \
      -q '.mergeable + " " + .mergeStateStatus' 2>&1); then
    query_error="$raw"
    break
  fi
  read -r mergeable state <<<"$raw"
  if [[ "$mergeable" != "UNKNOWN" && "$state" != "UNKNOWN" ]]; then
    break
  fi
  if [[ "$attempt" -lt "$MERGEABILITY_ATTEMPTS" ]]; then
    sleep "$MERGEABILITY_DELAY"
  fi
done

# Each arm reports the condition it actually established. UNSTABLE/BEHIND/DRAFT are
# documented, precise states GitHub *has* established — UNSTABLE especially, since this
# gate is what you poll while CI runs — so they get their own line rather than being
# swept into "unrecognised". CONFLICTING is tested before UNKNOWN so a real conflict is
# never softened into "not yet computed".
if [[ -n "$query_error" ]]; then
  echo "MERGEABLE: FAIL — could not query GitHub for PR #$PR: $query_error"
  fail=1
elif [[ "$mergeable" == "MERGEABLE" && "$state" == "CLEAN" ]]; then
  echo "MERGEABLE: ok ($state)"
elif [[ "$mergeable" == "CONFLICTING" ]]; then
  echo "MERGEABLE: FAIL (mergeable=$mergeable state=$state) — rebase/resolve conflicts"
  fail=1
elif [[ "$mergeable" == "UNKNOWN" || "$state" == "UNKNOWN" ]]; then
  echo "MERGEABLE: FAIL (mergeable=$mergeable state=$state) — GitHub has not finished computing mergeability"
  echo "    after $MERGEABILITY_ATTEMPTS polls over $((MERGEABILITY_DELAY * (MERGEABILITY_ATTEMPTS - 1)))s. This says nothing about conflicts — it is routine for a minute"
  echo "    or so after main moves. Re-run the gate."
  fail=1
elif [[ "$state" == "UNSTABLE" ]]; then
  echo "MERGEABLE: FAIL (mergeable=$mergeable state=$state) — mergeable, but a check or commit"
  echo "    status is not passing. Gate 2 below reads check runs only, so a failing commit"
  echo "    STATUS shows here and not there."
  fail=1
elif [[ "$state" == "BEHIND" ]]; then
  echo "MERGEABLE: FAIL (mergeable=$mergeable state=$state) — head is behind base; update the branch"
  fail=1
elif [[ "$state" == "DRAFT" ]]; then
  echo "MERGEABLE: FAIL (mergeable=$mergeable state=$state) — PR is a draft; mark it ready"
  fail=1
else
  echo "MERGEABLE: FAIL (mergeable=$mergeable state=$state) — unrecognised combination, neither"
  echo "    MERGEABLE/CLEAN nor CONFLICTING. Raw values above; no cause established."
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
#
# Invoked via `bash` deliberately, for the reason docs-check.yml already documents: this repo
# lives on a Windows/WSL mount where the executable bit does not survive, so scripts/ is
# committed 100644. Executing it directly works on the author's mount (drvfs reports every
# file executable) and dies with "Permission denied" on any Linux checkout — gate 3 then
# prints an empty verdict and blocks the merge for a reason that is not about the PR. Found
# by the self-test's first CI run, which is the point of wiring it in.
if deploy=$(bash "$DIR/deploy-status.sh"); then
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
