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

# Quiescence: any of the last 5 runs not yet finished means "in progress". `waiting`,
# `requested` and `pending` are pre-run states (deployment approval, queueing) — they used
# to fall through to the NOT SAFE line below and be reported as "fix main first", which
# blames main for a run that has not started. Same defect class as TI-77: a check must not
# assert a cause it has not established.
if echo "$runs" | grep -qE '"status":"(in_progress|queued|waiting|requested|pending)"'; then
  read -r num st <<<"$(echo "$runs" | python3 -c 'import json,sys
r=json.load(sys.stdin)
x=next((x for x in r if x["status"] in ("in_progress","queued","waiting","requested","pending")), None)
print(x["number"] if x else "?", x["status"] if x else "?")')"
  echo "IN PROGRESS (#$num status=$st) — wait, do not merge"
  exit 1
fi

# Latest run is first element.
read -r status conclusion number <<<"$(echo "$runs" | python3 -c 'import json,sys; r=json.load(sys.stdin); x=r[0]; print(x["status"], x["conclusion"], x["number"])')"

if [[ "$status" == "completed" && "$conclusion" == "success" ]]; then
  echo "GREEN (#$number) — safe to merge"
  exit 0
fi

# Reserve "fix main first" for a run that actually finished badly. Anything else reports
# the raw values and names no cause.
if [[ "$status" == "completed" ]]; then
  echo "NOT SAFE (#$number status=$status conclusion=$conclusion) — main's last deploy did not succeed, fix main first"
else
  echo "NOT SAFE (#$number status=$status conclusion=$conclusion) — unrecognised run state; raw values above, no cause established"
fi
exit 1
