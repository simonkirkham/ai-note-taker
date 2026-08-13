#!/usr/bin/env bash
#
# Reconciles the recent commits on main against their check-suites, and names any commit that
# nothing ever looked at.
#
#   bash scripts/check-main-checked.sh [count] [ref]
#
# (invoked via `bash`: scripts/ is committed 100644, so a bare invocation fails on any
# checkout that did not come off a mount which reports every file executable)
#
# Exit code: 0 = every commit was checked, 1 = at least one commit reached main with nothing
# run against it, 2 = could not determine. See "THREE OUTCOMES" below — 2 is the whole point.
#
# --- Why this exists ----------------------------------------------------------------------
#
# TI-90. A commit can land on main and have NO checks run against it at all — no failure, no
# red X, no trace anywhere. Nothing complains, so main looks checked when it was never looked
# at. Measured on 2026-08-13: commit 4727672f (the TI-81 squash merge) has total_count 0 on
# its check-suites, no apps at all, while 14a4a48f and c12fa2c9 either side of it each have 2.
#
# The absence is the symptom AND the reason nobody noticed. Every other guard in this repo
# reports a state it observed; this failure is the guard never being asked. A red X gets
# investigated within minutes, and a missing run gets investigated never, because there is
# nothing on any screen to investigate. So the only way to catch it is to go and reconcile
# what is on main against what ran — which is what this does.
#
# It is deliberately NOT a workflow-config check. docs-check.yml is byte-identical between
# 14a4a48f and 4727672f, all three files 4727672f changed are in its push paths list, and its
# concurrency group is keyed by github.sha on a push so no push can cancel another. Decisively:
# CodeRabbit is absent from 4727672f too, and a paths: filter cannot suppress an unrelated
# app. Zero suites across every app means no check machinery was triggered at all — most
# parsimoniously, no push event was delivered GitHub-side.
#
# TI-83 does not close this. Dropping a paths: list changes what happens when a push event
# ARRIVES; it does nothing at all when no push event arrives. Same family as TI-88 and the
# archived TI-81: a gate reporting a state that is not the state now.
#
# --- THREE OUTCOMES, and why the third one is the important one ----------------------------
#
# The natural implementation reads total_count and compares it to 0. A 401, a rate limit, a
# dropped connection, a proxy error page, and a body missing the field ALL look like 0 to
# that, and every one of them would print an all-clear.
#
# A verification that silently degrades into a pass produces an artefact indistinguishable
# from the real thing, and nobody re-runs a green. That is worse here than almost anywhere
# else, because this script IS the thing that notices when nothing else did: a backstop
# reporting "all clear" because it could not reach the API manufactures exactly the false
# confidence it exists to remove. So:
#
#   exit 0  all checked        every commit in the window has a check-suite
#   exit 1  UNCHECKED          a commit is confirmed to have none — a hole in main
#   exit 2  could not determine the question was not answered — run it again
#
# 1 and 2 are opposite instructions (fix it / ask again) and never share a code or a word.
# Anything not positively established falls to 2, including shapes nobody has seen: an
# allow-list, so an unanticipated response can only make this more conservative, never less.
set -uo pipefail

COUNT="${1:-30}"
REF="${2:-main}"

# A commit pushed seconds ago has no check-suite YET. Ten minutes is far longer than suite
# creation takes (seconds) and far shorter than the daily cadence this runs on, so it costs
# nothing and removes the only real false-positive source.
#
# Measured against the COMMITTER date, which is the closest thing to a push time the commit
# itself carries. The assumption that buys: a commit authored long ago but pushed just now
# would be judged outside its grace window. Squash merges set the committer date to the merge
# instant and direct doc pushes commit-then-push within seconds, so in this repo the two are
# the same to within a minute. Stated rather than hidden, because it is the one input that
# could make this cry wolf.
GRACE_MINUTES="${CHECK_MAIN_GRACE_MINUTES:-10}"

# Off by default. A commit with suites from some other app but none from github-actions had
# its push event delivered — another app demonstrably reacted to it — and simply matched no
# workflow. Measured on 2026-08-13: 20 of the last 40 commits on main are in exactly that
# state, because deploy.yml paths-ignores docs/** and docs-check.yml only gained its push
# trigger at TI-80. Failing on those is a 50% false-alarm rate on real history, and an alarm
# that cries wolf every other commit is one nobody reads.
#
# Set to 1 once TI-83 makes every push to main trigger a workflow, at which point the absence
# of an Actions suite becomes a real finding rather than the configured behaviour.
REQUIRE_ACTIONS="${CHECK_MAIN_REQUIRE_ACTIONS:-0}"

if ! [[ "$COUNT" =~ ^[0-9]+$ ]] || (( COUNT < 1 )) || (( COUNT > 100 )); then
  echo "MAIN-CHECKED: COULD NOT DETERMINE — count must be 1-100 (the commits API pages at 100), got '$COUNT'"
  exit 2
fi

# The commit list comes from the API rather than from local git, for two reasons. A scheduled
# workflow checks out shallow, so `git rev-list -n 30` would silently walk fewer commits than
# asked for. And a local origin/main can be hours stale — the question is what is on main at
# GitHub, so GitHub is who to ask.
if ! commits=$(gh api "repos/{owner}/{repo}/commits?sha=$REF&per_page=$COUNT" 2>&1); then
  echo "MAIN-CHECKED: COULD NOT DETERMINE — could not read the commit list for $REF: $(echo "$commits" | tr '\n' ' ' | cut -c1-200)"
  exit 2
fi

if ! out=$(echo "$commits" | GRACE_MINUTES="$GRACE_MINUTES" REQUIRE_ACTIONS="$REQUIRE_ACTIONS" \
    REF="$REF" python3 -c '
import json, os, subprocess, sys
from datetime import datetime, timezone

GRACE = float(os.environ["GRACE_MINUTES"])
REQUIRE_ACTIONS = os.environ["REQUIRE_ACTIONS"] == "1"
REF = os.environ["REF"]

# Bounded, because an unbounded call inside a scheduled job hangs it silently and
# indefinitely. A timeout is an unreadable API, which is outcome 2.
API_TIMEOUT_SECONDS = 20


def suites_for(sha):
    """Returns (info, error). Exactly one is None.

    Every path that cannot ESTABLISH what ran returns an error, so an unreachable API, a
    proxy error page, a missing field or a shape nobody has seen can only produce outcome 2.
    There is deliberately no fallback that treats an unrecognised response as zero suites:
    that single line is the whole defect this design is built to avoid.
    """
    path = "repos/{owner}/{repo}/commits/%s/check-suites?per_page=100" % sha
    try:
        p = subprocess.run(["gh", "api", path], capture_output=True, text=True,
                           timeout=API_TIMEOUT_SECONDS)
    except subprocess.TimeoutExpired:
        return None, "no response within %ds" % API_TIMEOUT_SECONDS
    except OSError as e:
        return None, str(e)
    # 1. The exit status, before the body is looked at. A non-zero gh is an ERROR verdict and
    #    never a zero-suite verdict, whatever it printed.
    if p.returncode != 0:
        return None, " ".join((p.stderr or p.stdout).split())[:160]
    # 2. It parsed. A 502 proxy page is not JSON.
    try:
        body = json.loads(p.stdout)
    except ValueError:
        return None, "unparseable response: %s" % " ".join(p.stdout.split())[:120]
    if not isinstance(body, dict):
        return None, "expected an object, got %s" % type(body).__name__
    # 3. It contained the field. This is the sharpest one: an API error body
    #    ({"message": "Not Found"}) parses perfectly well, and .get("total_count") or 0 reads
    #    it as a genuine zero. A missing field is an error, not a zero.
    total = body.get("total_count")
    if not isinstance(total, int):
        return None, "response carried no total_count (%s)" % " ".join(json.dumps(body).split())[:120]
    listed = body.get("check_suites")
    if not isinstance(listed, list):
        return None, "response carried no check_suites list"
    # 4. The count agrees with the array describing it. per_page=100 is far above the 2-5
    #    suites a commit here carries, so a disagreement means a truncated or paginated page
    #    and the set was not seen whole. Reading either number alone cannot tell.
    if len(listed) != total:
        return None, "read %d of %d suites (the response is paginated)" % (len(listed), total)
    apps = sorted({(s.get("app") or {}).get("slug") or "?" for s in listed})
    return {"total": total, "apps": apps, "actions": "github-actions" in apps}, None


def age_minutes(stamp):
    if not stamp:
        return None
    try:
        t = datetime.fromisoformat(str(stamp).replace("Z", "+00:00"))
    except ValueError:
        return None
    return (datetime.now(timezone.utc) - t).total_seconds() / 60.0


try:
    commits = json.load(sys.stdin)
except ValueError:
    print("ERR|could not parse the commit list for %s as JSON" % REF)
    sys.exit(0)
if not isinstance(commits, list):
    print("ERR|the commit list for %s was not a list (%s)" % (REF, type(commits).__name__))
    sys.exit(0)
if not commits:
    print("ERR|no commits returned for %s, so nothing at all was established" % REF)
    sys.exit(0)

unchecked, unverifiable, noactions, recent, ok = [], [], [], [], []
lines = []

for c in commits:
    sha = str(c.get("sha") or "")
    short = sha[:8] or "????????"
    commit = c.get("commit") or {}
    subject = str(commit.get("message") or "").split("\n")[0][:58]
    when = ((commit.get("committer") or {}).get("date"))

    info, err = suites_for(sha)
    if err is not None:
        # Never spelled like a zero, and never like a hole. A different word for a different
        # instruction: this one means ask again, not fix main.
        unverifiable.append(short)
        lines.append("  unverifiable %s  could not read its check-suites: %s  %s"
                     % (short, err, subject))
        continue

    if info["total"] == 0:
        age = age_minutes(when)
        if age is None:
            unverifiable.append(short)
            lines.append("  unverifiable %s  no suites, and no readable commit date to judge "
                         "whether it is simply too recent  %s" % (short, subject))
        elif age < GRACE:
            recent.append(short)
            lines.append("  too-recent   %s  no suites yet, committed %dm ago (inside the %dm "
                         "grace window)  %s" % (short, age, GRACE, subject))
        else:
            unchecked.append(short)
            lines.append("  UNCHECKED    %s  NO check-suite from ANY app, %dm after it landed "
                         "— nothing ran against this commit  %s" % (short, age, subject))
        continue

    if not info["actions"]:
        noactions.append(short)
        lines.append("  no-actions   %s  %d suite(s) (%s) but none from github-actions — the "
                     "push arrived, no workflow matched  %s"
                     % (short, info["total"], ", ".join(info["apps"]), subject))
        continue

    ok.append(short)
    lines.append("  ok           %s  %d suite(s) (%s)  %s"
                 % (short, info["total"], ", ".join(info["apps"]), subject))

print("REPORT|%d|%d|%d|%d|%d|%d|%s|%s|%s"
      % (len(commits), len(unchecked), len(unverifiable), len(noactions), len(recent), len(ok),
         ",".join(unchecked), ",".join(unverifiable), ",".join(noactions)))
for l in lines:
    print(l)
' 2>&1); then
  echo "MAIN-CHECKED: COULD NOT DETERMINE — the reconciliation itself failed (missing python3, or an unreadable response): $(echo "$out" | tr '\n' ' ' | cut -c1-200)"
  exit 2
fi

head=$(head -n1 <<<"$out")
if [[ "${head%%|*}" == "ERR" ]]; then
  echo "MAIN-CHECKED: COULD NOT DETERMINE — ${head#ERR|}"
  exit 2
fi
if [[ "${head%%|*}" != "REPORT" ]]; then
  echo "MAIN-CHECKED: COULD NOT DETERMINE — unrecognised output from the reconciliation: $(echo "$out" | tr '\n' ' ' | cut -c1-200)"
  exit 2
fi

IFS='|' read -r _ n_total n_unchecked n_unverifiable n_noactions n_recent n_ok l_unchecked l_unverifiable l_noactions <<<"$head"

echo "Reconciling the last $n_total commits on $REF against their check-suites (grace window ${GRACE_MINUTES}m)"
tail -n +2 <<<"$out"
echo ""

# A confirmed hole outranks an unanswered commit: it is the more actionable fact and it is
# established, where the other is a question. But the unanswered commits are still named on
# the same line — a window reported as "one hole, otherwise clean" while having silently
# skipped a commit is the same false confidence one level down.
extra=""
(( n_unverifiable > 0 )) && extra="  (and $n_unverifiable could not be determined: $l_unverifiable)"

if (( n_unchecked > 0 )); then
  echo "MAIN-CHECKED: FAILED — $n_unchecked of $n_total commits reached $REF with NO check-suite from any app: $l_unchecked$extra"
  echo "  Nothing ran against those commits and nothing anywhere reported it. See TI-90."
  exit 1
fi

if (( n_unverifiable > 0 )); then
  echo "MAIN-CHECKED: COULD NOT DETERMINE — $n_unverifiable of $n_total commits could not be read: $l_unverifiable"
  echo "  This is NOT an all-clear. Run it again; if it persists, the API or the token is the problem."
  exit 2
fi

if (( n_noactions > 0 )) && [[ "$REQUIRE_ACTIONS" == "1" ]]; then
  echo "MAIN-CHECKED: FAILED — $n_noactions of $n_total commits have no github-actions check-suite: $l_noactions"
  exit 1
fi

note=""
(( n_recent > 0 )) && note="$note, $n_recent too recent to judge"
(( n_noactions > 0 )) && note="$note, $n_noactions with suites but no workflow match"
echo "MAIN-CHECKED: GREEN — all $n_total commits on $REF were checked ($n_ok with a github-actions suite$note)"
exit 0
