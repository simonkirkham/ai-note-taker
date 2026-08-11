#!/usr/bin/env bash
#
# One-line verdict on whether main's deploy is safe to merge on top of.
# Encodes the CLAUDE.md merge-gate rule: never merge unless main's LATEST deploy
# is completed+success AND no deploy is in progress AND the recent runs are
# quiescent (a completed-success run can be re-run, flipping it back to
# in_progress — a single --limit 1 poll can catch a transient green mid-re-run).
#
#   bash scripts/deploy-status.sh
#
# (invoked via `bash`: scripts/ is committed 100644, so a bare invocation fails on any
# checkout that did not come off a mount which reports every file executable)
#
# Exit code: 0 = GREEN (safe), 1 = not safe (in progress / failed / unknown).
# Output is ONE line: the verdict. Parse stdout or just read it.
set -euo pipefail

WORKFLOW="${1:-deploy.yml}"

# Guard the query itself. Under `set -e` a failing `gh` (auth expiry, rate limit, no
# network) would abort here having printed nothing, and the caller's gate 3 would then show
# a blank verdict and block the merge with no reason on screen — the same "says nothing it
# established" failure this script exists to remove, one layer up.
if ! runs=$(gh run list --branch main --workflow "$WORKFLOW" --limit 5 \
    --json number,databaseId,status,conclusion,createdAt,updatedAt 2>&1); then
  echo "NOT SAFE — could not query GitHub for $WORKFLOW runs on main: $runs"
  exit 1
fi

# One pass decides AND reports, so the not-yet-finished status list exists in exactly one
# place. It used to be spelled out twice (a grep and a python tuple); dropping a status
# from the python half alone would still print "IN PROGRESS", which no test could see.
#
# Quiescence: any of the last 5 runs not yet finished means "in progress". `waiting`,
# `requested` and `pending` are pre-run states (deployment approval, queueing) — they used
# to fall through to the NOT SAFE line below and be reported as "fix main first", which
# blames main for a run that has not started.
#
# TI-81 adds the ONE exception to quiescence: an ORPHANED run record. Deploy #762
# (2026-08-11) had all five jobs completed+success — deploy-production finished 14:25:21Z —
# while the run's own status stayed `in_progress` with updated_at 14:24:22Z, 59 seconds
# EARLIER than its last job completed. This gate was read at 15:16:19Z and still said
# `IN PROGRESS (#762)`, blocking every session on the machine 51 minutes after that deploy
# had succeeded. The record settled on its own before the next reading at 15:49:39Z. So the
# failure is a false red lasting tens of minutes, not a permanent stall — which is worth
# stating precisely, because "it will never settle" invites a very different remedy
# (cancelling a run that succeeded) from "wait, or discount it safely".
#
# Quiescence itself is unchanged and stays; the exception is narrow, named, and always printed.
#
# The output is deliberately kept to ONE line: the caller (merge-gate.sh) relays this verdict
# inline after "MAIN DEPLOY: ", and a second line arrives there stripped of that prefix. So a
# discount rides in the verdict line rather than above it.
if ! verdict=$(echo "$runs" | python3 -c '
import json, subprocess, sys
from datetime import datetime, timezone

PENDING = ("in_progress", "queued", "waiting", "requested", "pending")

# --- Allow-list, not exclusion ------------------------------------------------------------
#
# Exactly two states mean "safe", and everything else blocks:
#
#   1. Normal            — run status == "completed" and conclusion == "success".
#   2. Stalled record    — run status is one of the KNOWN not-finished states (PENDING), AND
#                          the jobs response is complete (len == total_count), AND every job
#                          is status == "completed" with conclusion == "success", AND
#                          pending_deployments is empty, AND BOTH updated_at and the newest
#                          job completion are older than STALE_MINUTES.
#
# The form matters more than the clauses. SIX separate clauses of this condition moved rather
# than closed while it was being written — a job count, pending environment approvals, job
# conclusions (where "terminal" silently admits `failure`), the run status (never inspected at
# all, so a suspended run was discounted), jobs-API pagination (page 1 read as the whole set),
# and the staleness clock (keyed on the one field the incident proved unreliable). Six
# positions, one shape: a value absent, unexamined, or admitting more than its name suggests.
# Excluding the unsafe states requires enumerating everything that can go wrong, and that
# enumeration failed six times in a day; an allow-list FAILS CLOSED on anything unanticipated,
# which is the property a merge gate actually wants. So there is deliberately no `else`
# treating an unrecognised shape as fine: a status string that does not exist yet, a conclusion
# of `skipped` or `neutral`, a truncated jobs page, an empty job list or a missing field all
# fall through and block, printing the raw values seen.
#
# Why each clause of state 2 is there:
#
#   A KNOWN not-finished run status. classify() originally never looked at the run status, so
#   every status except "completed" was eligible. Proven with a stub: a run with status
#   `paused_for_maintenance`, all jobs completed+success and a stale record was discounted, and
#   beside an older green run the gate printed `GREEN — safe to merge` on a run suspended
#   mid-flight whose deploy-production had never started. A status meaning "held, will resume"
#   defeats every other clause at once — work is paused, so the created jobs ARE finished and
#   the record DOES go quiet.
#
#   A COMPLETE jobs response. `per_page` defaults to 30 and the response carries total_count; a
#   40-job run whose page-2 job is still executing would otherwise present 30 finished jobs and
#   be discounted. Not reachable with the 5 jobs deploy.yml has — which is the point of checking it
#   rather than asserting it.
#
#   Jobs all completed+success. Not merely "terminal": terminal admits failure, cancelled and
#   timed_out, and discounting one of those would report GREEN on a run whose deploy-production
#   failed — waving a merge onto a broken main, strictly worse than the false red being fixed.
#   `skipped` and `neutral` are excluded too; they are not failures, but they are also not the
#   named safe state, so a run carrying one is simply not discounted (it blocks, as today).
#   Over the last 20 main deploy runs, 100 jobs concluded 98 success / 1 skipped / 1 failure.
#
#   pending_deployments empty. The jobs clause is an ABSENT-VALUE reading: the jobs API returns
#   the jobs created SO FAR, so "every job is finished" looks identical whether nothing else is
#   coming or nothing else has been ALLOWED to start. deploy.yml declares `environment:` on both
#   deploy-test and deploy-production, so the day either gains a protection rule (a required
#   reviewer, a wait timer) a run can sit awaiting approval with NO job record for the gated job
#   at all — every created job finished, nothing transitioning, updated_at going stale. No
#   protection rules exist today (pending_deployments returns [] on every run; checked on #762
#   and #763), so this is LATENT — which is exactly why it needs a test rather than a comment.
#
#   BOTH clocks older than STALE_MINUTES. This is what closes the gap the others cannot: a run
#   that is going to create more jobs has, by definition, a MOVING updated_at. Ten minutes of
#   total silence with every job finished is unambiguous where two minutes would not be. Chosen
#   generous on purpose: the #762 record was already 51 minutes stale when this gate was read,
#   and the asymmetry is stark: waiting a few extra minutes on a genuinely slow run costs
#   nothing, while discounting a live deploy means merging on top of one nobody has verified.
#   The NEWEST JOB COMPLETION is required to be old as well, because updated_at is the field
#   this very incident proved untrustworthy — on #762 it froze 59 seconds BEFORE the last job
#   finished, i.e. it fails EARLY, in the direction that admits a discount sooner than the
#   truth warrants. A fix that keys solely on the misreporting clock inherits the defect it is
#   fixing; the job clock comes from a different part of the API and was correct on #762.
STALE_MINUTES = 10

# Not part of the safety decision — the allow-list above already blocks every one of these.
# This only decides how LOUDLY a blocked run is reported: a job that genuinely failed is the
# more actionable fact and gets named rather than folded into "wait".
#
# `cancelled` and `action_required` are deliberately NOT here. Entering the busy `deploy`
# concurrency group cancels the pending run rather than queuing it, so a cancelled job means
# superseded far more often than broken — the `case` block at the bottom of this same file
# exists precisely to stop that being reported as a broken main, and listing it here would
# have reintroduced TI-77 one screen above its own fix. Both still BLOCK; they just do not get
# a failure verdict pinned on them.
FAILED_CONCLUSIONS = ("failure", "timed_out", "startup_failure")

# API cost: TWO extra calls (jobs, pending_deployments) per NOT-FINISHED run, and none at all
# for a finished one. The normal case is a quiescent window, which pays nothing; the worst
# case is 5 not-finished runs = 10 extra calls. Both calls short-circuit: a run with a job
# still running never reaches the pending_deployments call.
#
# A bounded timeout because this runs inside a merge gate: without one, a hung connection
# hangs the gate silently and indefinitely, which is TI-79 in a different costume. A timeout
# is an unreadable API, which blocks.
API_TIMEOUT_SECONDS = 20


def gh_json(path):
    try:
        p = subprocess.run(["gh", "api", path], capture_output=True, text=True,
                           timeout=API_TIMEOUT_SECONDS)
    except subprocess.TimeoutExpired:
        return None, "no response within %ds" % API_TIMEOUT_SECONDS
    except OSError as e:
        return None, str(e)
    if p.returncode != 0:
        return None, " ".join((p.stderr or p.stdout).split())[:160]
    try:
        return json.loads(p.stdout), None
    except ValueError:
        return None, "unparseable response"


# Raw values are printed so the reader can go and look them up in the run being pointed at, so
# they have to be spelled the way the API spells them. Python renders a JSON null as "None",
# which matches nothing anyone can search for.
def shown(v):
    return "null" if v is None else str(v)


def age_minutes(stamp):
    if not stamp:
        return None
    try:
        t = datetime.fromisoformat(str(stamp).replace("Z", "+00:00"))
    except ValueError:
        return None
    return (datetime.now(timezone.utc) - t).total_seconds() / 60.0


def classify(r):
    """A not-finished run. Returns (outcome, message):

         discount — matches safe state 2 exactly; ignore it, and say so
         jobfail  — blocked, and a job actually failed: report NOT SAFE and name it
         block    — blocked for any other reason, including reasons not anticipated here

    Every path that cannot ESTABLISH safe state 2 returns block or jobfail, so an unreachable
    API, a missing field or a shape nobody has seen can only make the gate more conservative.
    """
    n = r.get("number")
    st = r.get("status")
    raw = "#%s status=%s" % (n, shown(st))

    rid = r.get("databaseId")
    if not rid:
        return "block", "%s: the run list carried no databaseId, so its jobs cannot be read" % raw
    # `per_page=100` because the default page is 30 and this reads the list as if it were the
    # whole set: a 40-job run whose page-2 job is still executing would present 30 finished
    # jobs and be discounted — failing OPEN, the one property this design claims not to have.
    # `filter=latest` is load-bearing rather than decorative: it is the default, but the
    # alternative (`all`) returns every ATTEMPT of a re-run, so the stale records of a superseded attempt
    # job records would be folded in as if current. Both are stated so neither can be dropped
    # as noise. deploy.yml has 5 jobs and no matrix today; the guard below is what makes that
    # a fact the script checks rather than an assumption it holds.
    jobs, err = gh_json(
        "repos/{owner}/{repo}/actions/runs/%s/jobs?per_page=100&filter=latest" % rid)
    if err is not None:
        return "block", "%s: could not read its jobs (%s)" % (raw, err)
    jl = jobs.get("jobs") or []
    if not jl:
        return "block", "%s: the run has created no jobs yet" % raw
    total = jobs.get("total_count")
    if total is None:
        return "block", "%s: the jobs response carried no total_count, so it cannot be shown complete" % raw
    if len(jl) != total:
        return "block", "%s: read %d of %d jobs (the response is paginated), so it cannot be established that every job finished" % (
            raw, len(jl), total)

    # The one job check. Not (completed, success) is not the safe state — whatever it is.
    unsafe = [j for j in jl
              if j.get("status") != "completed" or j.get("conclusion") != "success"]
    if unsafe:
        listed = ", ".join("%s status=%s conclusion=%s"
                           % (shown(j.get("name")), shown(j.get("status")), shown(j.get("conclusion")))
                           for j in unsafe[:3])
        if len(unsafe) > 3:
            listed += ", and %d more" % (len(unsafe) - 3)
        failed = [j for j in unsafe if j.get("conclusion") in FAILED_CONCLUSIONS]
        if failed:
            return "jobfail", "%s: %d of %d jobs did not succeed (%s)" % (
                raw, len(unsafe), len(jl), listed)
        return "block", "%s: %d of %d jobs are not completed+success (%s)" % (
            raw, len(unsafe), len(jl), listed)

    pend, err = gh_json("repos/{owner}/{repo}/actions/runs/%s/pending_deployments" % rid)
    if err is not None:
        return "block", "%s: could not read its pending deployments (%s)" % (raw, err)
    if pend:
        return "block", "%s: all %d jobs are completed+success, but %d deployment(s) await approval" % (
            raw, len(jl), len(pend))

    # TWO clocks, and both must be old. `updated_at` is the field the incident proved
    # unreliable — on #762 it froze at 14:24:22Z, 59 seconds BEFORE the last job finished at
    # 14:25:21Z, i.e. it failed EARLY, in the direction that admits a discount sooner than the
    # truth warrants. Keying the staleness test solely on the field that misreports is how a
    # fix inherits the defect it is fixing. The newest job completion is derived from a
    # different part of the API and would still have been correct on #762, so requiring both
    # means a single misreporting clock cannot open the gate on its own.
    age = age_minutes(r.get("updatedAt"))
    if age is None:
        return "block", "%s: the run record carried no readable updatedAt" % raw

    job_ages = [age_minutes(j.get("completed_at")) for j in jl]
    if any(a is None for a in job_ages):
        return "block", "%s: a job carried no readable completed_at, so the run cannot be shown finished" % raw
    job_age = min(job_ages)

    if age < STALE_MINUTES or job_age < STALE_MINUTES:
        return "block", "%s: all %d jobs completed+success, but the record was updated %dm ago and the newest job finished %dm ago (threshold %dm)" % (
            raw, len(jl), age, job_age, STALE_MINUTES)

    # Every clause named, not just the one that tripped last: the next person reuses whichever
    # clause they remember, and a message that reports only part of its reasoning is how a
    # half-condition gets copied into the next gate.
    return "discount", "#%s orphaned (all %d jobs completed+success; no deployments awaiting approval; record stale since %s, %dm, and newest job finished %dm ago, both > %dm threshold) — ignoring" % (
        n, len(jl), shown(r.get("updatedAt")), age, job_age, STALE_MINUTES)


runs = json.load(sys.stdin)
discounts, blocks, jobfails, ignored = [], [], [], set()

for r in runs:
    st = r.get("status")
    if st == "completed":
        continue
    # PENDING is an ELIGIBILITY allow-list, not a label. Only a run in a status known to mean
    # "not finished yet" may be considered for the stalled-record exception; any other status
    # blocks outright and prints what it saw.
    #
    # This was a real hole, not a hypothetical: classify() never looked at the run status, so
    # ANY status other than "completed" was eligible. A stub run with status
    # `paused_for_maintenance`, all jobs completed+success and a stale record was discounted,
    # and beside an older green run the gate printed `GREEN (#899) — safe to merge` on a run
    # suspended mid-flight whose deploy-production had never started. A future status meaning
    # "held, will resume" is exactly the shape that breaks the other clauses: work is paused,
    # so every created job IS finished and the record DOES go quiet.
    if st not in PENDING:
        blocks.append("#%s status=%s: unrecognised run status, not one of the known "
                      "not-finished states %s; not eligible to be discounted"
                      % (r.get("number"), shown(st), "/".join(PENDING)))
        continue
    outcome, msg = classify(r)
    if outcome == "discount":
        discounts.append(msg)
        ignored.add(r.get("number"))
    elif outcome == "jobfail":
        jobfails.append(msg)
    else:
        blocks.append(msg)

note = "; ".join(discounts)

if not runs:
    kind, number, status, conclusion, detail = "EMPTY", "", "", "", ""
elif jobfails:
    # Ahead of a plain block: a run with a genuinely failed job is the more actionable fact,
    # and it is never discounted however stale its record has become.
    kind, number, status, conclusion, detail = "JOBFAIL", "", "", "", "; ".join(jobfails)
elif blocks:
    kind, number, status, conclusion, detail = "PENDING", "", "", "", "; ".join(blocks)
else:
    # Sorted explicitly rather than trusting the order gh happened to return. createdAt was
    # already being fetched and never used, which is the cheaper half of the same bug: the
    # newest run decides the verdict, so "newest" has to be established, not assumed.
    live = sorted((r for r in runs if r.get("number") not in ignored),
                  key=lambda r: str(r.get("createdAt") or ""), reverse=True)
    if not live:
        kind, number, status, conclusion, detail = "NONE", "", "", "", ""
    else:
        latest = live[0]
        kind = "LATEST"
        number = latest.get("number")
        status = latest.get("status")
        conclusion = latest.get("conclusion") if latest.get("conclusion") else "null"
        detail = ""

# Pipe-delimited so a message containing spaces survives the handoff intact. Any `|` or
# newline INSIDE a field is replaced first: the bash side splits on `|` and `read` takes only
# the first line, so a gh error or job name containing either would shift every later field —
# printing a fabricated `[discounted: ...]` annotation on a run that nothing discounted. The
# exit code is unaffected (kind is field 1), but the discount annotation is the disclosure
# this whole design leans on, so it must not be forgeable by an error string.
def clean(v):
    return str(v).replace("|", "/").replace("\n", " ").replace("\r", " ")


print("|".join(clean(x) for x in (kind, number, status, conclusion, detail, note)))
' 2>&1); then
  echo "NOT SAFE — could not read the run list (missing python3, or gh returned something unparseable): $verdict"
  exit 1
fi
IFS='|' read -r kind number status conclusion detail note <<<"$verdict"

# The discount rides on every verdict, whatever it is. A gate that quietly ignores runs is
# worse than one that blocks, because nobody can tell it is doing it.
suffix=""
[[ -n "$note" ]] && suffix="  [discounted: $note]"

if [[ "$kind" == "EMPTY" ]]; then
  echo "NOT SAFE — no runs found for workflow $WORKFLOW on main; nothing established about main"
  exit 1
fi

if [[ "$kind" == "JOBFAIL" ]]; then
  echo "NOT SAFE — $detail; main's last deploy did not succeed, fix main first$suffix"
  exit 1
fi

if [[ "$kind" == "PENDING" ]]; then
  echo "IN PROGRESS ($detail) — wait, do not merge$suffix"
  exit 1
fi

if [[ "$kind" == "NONE" ]]; then
  echo "NOT SAFE — every run in the window was discounted, so nothing is established about main$suffix"
  exit 1
fi

if [[ "$status" == "completed" && "$conclusion" == "success" ]]; then
  echo "GREEN (#$number) — safe to merge$suffix"
  exit 0
fi

# "fix main first" is reserved for a run that actually finished badly. A `cancelled` run is
# normally superseded — entering the busy `deploy` concurrency group cancels the pending run
# rather than queuing it (see e2e.yml) — so calling it a broken main sends the investigation
# to a main that is fine. Same defect class as TI-77.
case "$conclusion" in
  failure | timed_out | startup_failure)
    echo "NOT SAFE (#$number status=$status conclusion=$conclusion) — main's last deploy did not succeed, fix main first$suffix" ;;
  cancelled)
    # One line deliberately: the caller relays this verdict inline after "MAIN DEPLOY: ",
    # and a second line arrives there stripped of that prefix.
    echo "NOT SAFE (#$number status=$status conclusion=$conclusion) — cancelled, not failed; usually superseded by a later run or an e2e.yml dispatch. Re-check before concluding anything about main$suffix" ;;
  *)
    echo "NOT SAFE (#$number status=$status conclusion=$conclusion) — unrecognised run state; raw values above, no cause established$suffix" ;;
esac
exit 1
