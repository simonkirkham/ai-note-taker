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

# One pass decides AND reports, so the not-yet-finished status list exists in exactly one
# place. It used to be spelled out twice (a grep and a python tuple); dropping a status
# from the python half alone would still print "IN PROGRESS", which no test could see.
#
# Quiescence: any of the last 5 runs not yet finished means "in progress". `waiting`,
# `requested` and `pending` are pre-run states (deployment approval, queueing) — they used
# to fall through to the NOT SAFE line below and be reported as "fix main first", which
# blames main for a run that has not started.
verdict=$(echo "$runs" | python3 -c '
import json, sys

PENDING = ("in_progress", "queued", "waiting", "requested", "pending")
runs = json.load(sys.stdin)

if not runs:
    print("EMPTY")
elif (p := next((r for r in runs if r["status"] in PENDING), None)) is not None:
    print("PENDING", p["number"], p["status"])
else:
    latest = runs[0]
    print("LATEST", latest["number"], latest["status"],
          latest["conclusion"] if latest["conclusion"] is not None else "null")
')
read -r kind number status conclusion <<<"$verdict"

if [[ "$kind" == "EMPTY" ]]; then
  echo "NOT SAFE — no runs found for workflow $WORKFLOW on main; nothing established about main"
  exit 1
fi

if [[ "$kind" == "PENDING" ]]; then
  echo "IN PROGRESS (#$number status=$status) — wait, do not merge"
  exit 1
fi

if [[ "$status" == "completed" && "$conclusion" == "success" ]]; then
  echo "GREEN (#$number) — safe to merge"
  exit 0
fi

# "fix main first" is reserved for a run that actually finished badly. A `cancelled` run is
# normally superseded — entering the busy `deploy` concurrency group cancels the pending run
# rather than queuing it (see e2e.yml) — so calling it a broken main sends the investigation
# to a main that is fine. Same defect class as TI-77.
case "$conclusion" in
  failure | timed_out | startup_failure)
    echo "NOT SAFE (#$number status=$status conclusion=$conclusion) — main's last deploy did not succeed, fix main first" ;;
  cancelled)
    echo "NOT SAFE (#$number status=$status conclusion=$conclusion) — cancelled, not failed; usually"
    echo "    superseded by a later run or an e2e.yml dispatch. Re-check before concluding anything about main" ;;
  *)
    echo "NOT SAFE (#$number status=$status conclusion=$conclusion) — unrecognised run state; raw values above, no cause established" ;;
esac
exit 1
