#!/usr/bin/env bash
#
# One-line verdict on whether main's deploy is safe to merge on top of.
# Encodes the CLAUDE.md merge-gate rule: never merge unless main's LATEST deploy
# is completed+success AND no deploy is in progress AND the recent runs are
# quiescent (a completed-success run can be re-run, flipping it back to
# in_progress — a single --limit 1 poll can catch a transient green mid-re-run).
#
#   scripts/deploy-status.sh
#
# Exit code: 0 = GREEN (safe), 1 = not safe (in progress / failed / unknown).
# Output line is the verdict; parse stdout or just read it.
set -euo pipefail

WORKFLOW="${1:-deploy.yml}"

runs=$(gh run list --branch main --workflow "$WORKFLOW" --limit 5 \
  --json number,status,conclusion,createdAt)

# Quiescence: any of the last 5 runs still running means "in progress".
if echo "$runs" | grep -q '"status":"in_progress"\|"status":"queued"'; then
  num=$(echo "$runs" | python3 -c 'import json,sys; r=json.load(sys.stdin); print(next((x["number"] for x in r if x["status"] in ("in_progress","queued")), "?"))')
  echo "IN PROGRESS (#$num running) — wait, do not merge"
  exit 1
fi

# Latest run is first element.
read -r status conclusion number <<<"$(echo "$runs" | python3 -c 'import json,sys; r=json.load(sys.stdin); x=r[0]; print(x["status"], x["conclusion"], x["number"])')"

if [[ "$status" == "completed" && "$conclusion" == "success" ]]; then
  echo "GREEN (#$number) — safe to merge"
  exit 0
fi

echo "NOT SAFE (#$number status=$status conclusion=$conclusion) — fix main first"
exit 1
