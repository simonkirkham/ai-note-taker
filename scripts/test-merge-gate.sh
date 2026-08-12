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
    # The full argv is recorded so a case can assert HOW the query was scoped, not merely what
    # it returned. Every other arm here ignores gh's arguments, which is exactly why a dropped
    # --workflow filter would be invisible to the whole suite.
    [ -n "${GH_ARGV:-}" ] && printf '%s\n' "$*" >>"$GH_ARGV"
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
    # The query string (`?per_page=100&filter=latest`) is stripped before dispatch. Leaving it
    # on made every jobs call an unhandled path, which the gate reported honestly as "could not
    # read its jobs" — conservative, and a good sign, but it meant the fixtures were never read.
    path="$2"; rid="${path#*/actions/runs/}"; what="${rid#*/}"; rid="${rid%%/*}"
    what="${what%%\?*}"
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

# TI-81 fixtures.
API="$STUB/api"; mkdir -p "$API"

# Timestamps are relative to now, so the staleness clauses are exercised against the real clock
# rather than a date that ages into or out of the threshold. STALE is well past the 10m bar
# (#762 was 73m); FRESH is well inside it.
STALE=$(date -u -d '-45 minutes' +%Y-%m-%dT%H:%M:%SZ)
FRESH=$(date -u -d '-2 minutes' +%Y-%m-%dT%H:%M:%SZ)

# jobs_fixture <runid> <"name:status:conclusion[:completed_at]"> ...
# A completed job defaults to having finished at $STALE; anything not completed carries
# completed_at null, as the API returns. total_count matches the job count unless a case
# overrides the file afterwards, so the pagination guard sees a complete response by default.
jobs_fixture() {
  local rid="$1"; shift
  local out="" j n=0
  for j in "$@"; do
    IFS=: read -r jn js jc jdone <<<"$j"
    [[ "$jc" == "null" ]] && jc="null" || jc="\"$jc\""
    if [[ "$js" == "completed" ]]; then jdone="\"${jdone:-$STALE}\""; else jdone="null"; fi
    out="$out${out:+,}{\"name\":\"$jn\",\"status\":\"$js\",\"conclusion\":$jc,\"completed_at\":$jdone}"
    n=$((n + 1))
  done
  printf '{"total_count":%d,"jobs":[%s]}\n' "$n" "$out" >"$API/$rid.jobs.json"
}
pending_fixture() { printf '%s\n' "$2" >"$API/$1.pending.json"; }

# The default answers say "a job is still running", so any not-finished run a case does not
# explicitly describe blocks — the conservative direction, and it keeps a case that forgets a
# fixture from silently passing through the discount path.
jobs_fixture default deploy-test:in_progress:null
printf '[]\n' >"$API/default.pending.json"

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
printf '{"total_count":0,"jobs":[]}\n' >"$API/8.jobs.json"
run_deploy "waiting-for-approval is not a broken main" \
                                 1 "IN PROGRESS" "fix main first"  "[{\"number\":8,\"databaseId\":8,\"status\":\"waiting\",\"conclusion\":null,\"updatedAt\":\"$FRESH\"}]"
# Asserts `fix main first` POSITIVELY. Four other cases assert its absence and none its
# presence, so rewording it out of the failure arm went unnoticed by the whole suite.
run_deploy "failed main"         1 "fix main first" -             '[{"number":9,"status":"completed","conclusion":"failure"}]'
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
# createdAt is carried on every run here because the verdict is read off the NEWEST live run,
# and "newest" is established by sorting on createdAt rather than by trusting the order gh
# returned. A fixture without it cannot exercise that sort at all — which is how the sort
# shipped untested, its failure mode being a GREEN on a failed main (see the pair below).
ORPHAN_762="{\"number\":762,\"databaseId\":762,\"status\":\"in_progress\",\"conclusion\":null,\"createdAt\":\"2026-08-11T14:17:31Z\",\"updatedAt\":\"$STALE\"},{\"number\":763,\"databaseId\":763,\"status\":\"completed\",\"conclusion\":\"success\",\"createdAt\":\"2026-08-11T14:56:41Z\",\"updatedAt\":\"$FRESH\"}"

run_deploy "an orphaned record is discounted, and said so" \
                                 0 "orphaned" -   "[$ORPHAN_762]"

# The verdict is read off the newest LIVE run, so which run is newest decides GREEN vs NOT SAFE.
# Nothing tested that until now: every other fixture has one live run, so the sort could not be
# wrong. Dropping `reverse=True` left the suite 47/47 green while turning a window whose newest
# run FAILED into `GREEN — safe to merge`. The pair below is ordered newest-last in the list on
# purpose, so a sort that is absent, reversed, or reading the wrong key cannot pass by accident.
SORT_WINDOW="{\"number\":805,\"databaseId\":805,\"status\":\"completed\",\"conclusion\":\"success\",\"createdAt\":\"2026-08-11T10:00:00Z\",\"updatedAt\":\"$STALE\"},{\"number\":809,\"databaseId\":809,\"status\":\"completed\",\"conclusion\":\"failure\",\"createdAt\":\"2026-08-11T18:00:00Z\",\"updatedAt\":\"$STALE\"}"
run_deploy "the newest run decides the verdict, not the list order" \
                                 1 "#809" "safe to merge" "[$SORT_WINDOW]"
run_deploy "  ...and an older green cannot mask a newer failure" \
                                 1 "did not succeed" "#805" "[$SORT_WINDOW]"
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

# The case above is held by the FRESHNESS clause, not the job clause — which makes it a weak
# test of the job clause, and it took an injected defect to notice: neutering the job check
# left it passing. This one removes that cover. A SLOW deploy, still executing, whose record
# has gone stale between job transitions: only the job clause can block it, and it must. A
# deploy running longer than the staleness threshold is ordinary, not exceptional.
jobs_fixture 779 detect-changes:completed:success deploy-test:in_progress:null
pending_fixture 779 '[]'
run_deploy "a slow run still executing is not orphaned, however stale its record" \
                                 1 "deploy-test status=in_progress" "orphaned" \
  "[{\"number\":779,\"databaseId\":779,\"status\":\"in_progress\",\"conclusion\":null,\"updatedAt\":\"$STALE\"}]"

# Clause 3's own red test: identical to #762 in every way except a fresh record.
five_green 771
pending_fixture 771 '[]'
run_deploy "a fresh record is not orphaned, however finished its jobs look" \
                                 1 "but the record was updated" "orphaned" \
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
# Positive assertion is `did not succeed`, the JOBFAIL arm's own phrase — not the generic
# `NOT SAFE`, which several arms share. Two other cases assert this phrase's ABSENCE to prove
# they took the block arm instead, and until this line nothing asserted its presence: rewording
# the jobfail message therefore went undetected, which would in time hollow out those two
# negatives exactly as round 2 hollowed out the cancelled case. Every arm-selecting phrase in
# this suite is now pinned positively somewhere.
run_deploy "a failed job is never discounted, however stale the record" \
                                 1 "did not succeed" "orphaned" \
  "[{\"number\":773,\"databaseId\":773,\"status\":\"in_progress\",\"conclusion\":null,\"updatedAt\":\"$STALE\"}]"
# TI-77's rule again, and the half that survived round 1: the run carrying the failed job is
# whichever unsettled run the window happened to contain, NOT necessarily main's latest —
# deploy.yml scopes concurrency at job level, so runs do not queue as units. Here #801 is
# main's newest and it succeeded, so "main's last deploy did not succeed, fix main first" would
# send the investigation to a main that is fine.
jobs_fixture 799 deploy-production:completed:failure
pending_fixture 799 '[]'
run_deploy "a failed job on an older run does not accuse main" \
                                 1 "is main's latest" "fix main first" \
  "[{\"number\":799,\"databaseId\":799,\"status\":\"in_progress\",\"conclusion\":null,\"createdAt\":\"2026-08-11T09:00:00Z\",\"updatedAt\":\"$STALE\"},{\"number\":801,\"databaseId\":801,\"status\":\"completed\",\"conclusion\":\"success\",\"createdAt\":\"2026-08-11T12:00:00Z\",\"updatedAt\":\"$STALE\"}]"

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

# A run status this script has never seen must fail closed, and print what it saw.
#
# This was ONE case and it was vacuous: its fixture also gave the run a job in an unrecognised
# state, so the job clause did the blocking and the assertion (`status=warping_in`) matched the
# `raw` prefix every block message carries. It passed with the run status ignored entirely —
# which it was. Injection found it, twice over: it flipped under the JOB-clause injection, and
# deleting the status annotation left the suite green.
#
# Split in two. The first is the shape the old case actually tested; the second is the hole —
# a run whose status is unknown but whose jobs all look finished and whose record is stale,
# which was DISCOUNTED before the eligibility check, printing `GREEN — safe to merge` on a run
# suspended mid-flight with deploy-production never started.
jobs_fixture 775 detect-changes:some_future_state:null
pending_fixture 775 '[]'
run_deploy "an unrecognised run status blocks when its jobs are unfinished too" \
                                 1 "status=warping_in" "orphaned" \
  "[{\"number\":775,\"databaseId\":775,\"status\":\"warping_in\",\"conclusion\":null,\"updatedAt\":\"$STALE\"}]"

five_green 790
pending_fixture 790 '[]'
run_deploy "an unrecognised run status is not eligible to be discounted, however finished it looks" \
                                 1 "not eligible to be discounted" "orphaned" \
  "[{\"number\":790,\"databaseId\":790,\"status\":\"paused_for_maintenance\",\"conclusion\":null,\"updatedAt\":\"$STALE\"}]"
run_deploy "  ...and it must never reach a GREEN beside a healthy older run" \
                                 1 "IN PROGRESS" "safe to merge" \
  "[{\"number\":790,\"databaseId\":790,\"status\":\"paused_for_maintenance\",\"conclusion\":null,\"createdAt\":\"2026-08-11T14:00:00Z\",\"updatedAt\":\"$STALE\"},{\"number\":789,\"databaseId\":789,\"status\":\"completed\",\"conclusion\":\"success\",\"createdAt\":\"2026-08-11T13:00:00Z\",\"updatedAt\":\"$FRESH\"}]"

# Pagination. `per_page` defaults to 30 and the response carries total_count; reading page 1 as
# the whole set would discount a 40-job run whose page-2 job is still executing. Not reachable
# with deploy.yml's 5 jobs — which is why it is a test and not a comment.
five_green 780
pending_fixture 780 '[]'
python3 - "$API/780.jobs.json" <<'PY'
import json, sys
p = sys.argv[1]
d = json.load(open(p))
d["total_count"] = 40          # 40 jobs exist; the response carries only the 5 on page 1
json.dump(d, open(p, "w"))
PY
run_deploy "a truncated jobs page cannot establish that every job finished" \
                                 1 "read 5 of 40 jobs" "orphaned" \
  "[{\"number\":780,\"databaseId\":780,\"status\":\"in_progress\",\"conclusion\":null,\"updatedAt\":\"$STALE\"}]"

# The second clock. updated_at is the field the incident proved unreliable — on #762 it froze
# 59s BEFORE the last job finished, i.e. it fails in the direction that admits a discount too
# early. So the newest job completion must be old as well, and a run whose record looks stale
# while a job finished seconds ago must still block.
jobs_fixture 781 detect-changes:completed:success "deploy-production:completed:success:$FRESH"
pending_fixture 781 '[]'
run_deploy "a job that finished moments ago blocks even when the record looks stale" \
                                 1 "newest job finished" "orphaned" \
  "[{\"number\":781,\"databaseId\":781,\"status\":\"in_progress\",\"conclusion\":null,\"updatedAt\":\"$STALE\"}]"

# TI-77's rule, one screen from its own fix: `cancelled` means superseded far more often than
# broken — the busy `deploy` concurrency group cancels the pending run rather than queuing it.
# It must block, but it must NOT be reported as a broken main.
jobs_fixture 782 detect-changes:completed:success deploy-production:completed:cancelled
pending_fixture 782 '[]'
# The "must not contain" string is `did not succeed`, NOT `fix main first`. This case asserted
# the latter until round 3 — and round 2's reword deleted that phrase from the JOBFAIL arm
# entirely, so the assertion became unfalsifiable and injection H (putting `cancelled` back into
# FAILED_CONCLUSIONS) flipped nothing, while the PR body claimed it did. A fix in one round
# silently de-fanging a test written in the previous one is the vacuous-case shape inverted.
# `did not succeed` is the phrase that actually separates the blocked path from the jobfail
# path, and it survives rewording of the tail.
run_deploy "a cancelled job blocks without blaming main" \
                                 1 "are not completed+success" "did not succeed" \
  "[{\"number\":782,\"databaseId\":782,\"status\":\"in_progress\",\"conclusion\":null,\"updatedAt\":\"$STALE\"}]"

# action_required was never covered on this path at all. It sits in the same "blocks, but is not
# a failure verdict" bucket as cancelled, and nothing established that.
jobs_fixture 784 detect-changes:completed:success deploy-production:completed:action_required
pending_fixture 784 '[]'
# The positive assertion must be ARM-UNIQUE. `conclusion=action_required` alone is printed by
# the block arm AND the jobfail arm (both share the `listed` detail), so only the negative
# selected the arm — and one reword of classify()'s jobfail return would empty this case in
# silence, exactly the way round 2 emptied the cancelled case. `are not completed+success`
# belongs to the block arm alone.
run_deploy "an action_required job blocks without a failure verdict" \
                                 1 "are not completed+success (deploy-production status=completed conclusion=action_required)" "did not succeed" \
  "[{\"number\":784,\"databaseId\":784,\"status\":\"in_progress\",\"conclusion\":null,\"updatedAt\":\"$STALE\"}]"

# A job reporting `completed` with NO completed_at. Unreachable from real payloads today, but it
# earns a case where the other unreachable guards do not, because the obvious tidy-up is
# actively dangerous: `min(a for a in job_ages if a is not None)` reads as harmless defensive
# cleanup and turns a run whose deploy-production never reported a completion into
# `GREEN — safe to merge`, exit 0. The guard must refuse to establish the clause, not skip it.
jobs_fixture 785 detect-changes:completed:success deploy-production:completed:success
pending_fixture 785 '[]'
python3 - "$API/785.jobs.json" <<'PY'
import json, sys
p = sys.argv[1]
d = json.load(open(p))
d["jobs"][1]["completed_at"] = None     # completed, but reported no completion time
json.dump(d, open(p, "w"))
PY
# Two runs, not one: with a single run a wrongly-granted discount collapses to "every run in
# the window was discounted", which still exits 1, so the case would pin the MESSAGE while
# the real failure mode — a false green — went unpinned. The older green gives the verdict
# somewhere to land, so the injection moves the exit code, which no rewording can de-fang.
run_deploy "a job with no completed_at cannot establish that the run finished" \
                                 1 "no readable completed_at" "safe to merge" \
  "[{\"number\":785,\"databaseId\":785,\"status\":\"in_progress\",\"conclusion\":null,\"createdAt\":\"2026-08-11T18:00:00Z\",\"updatedAt\":\"$STALE\"},{\"number\":786,\"databaseId\":786,\"status\":\"completed\",\"conclusion\":\"success\",\"createdAt\":\"2026-08-11T10:00:00Z\",\"updatedAt\":\"$STALE\"}]"

# An API that cannot be reached mid-decision must make the gate MORE conservative, never less.
printf '!FAIL gh: HTTP 503 upstream\n' >"$API/776.jobs.json"
run_deploy "an unreadable jobs API blocks, and names itself" \
                                 1 "could not read its jobs" "orphaned" \
  "[{\"number\":776,\"databaseId\":776,\"status\":\"in_progress\",\"conclusion\":null,\"updatedAt\":\"$STALE\"}]"

# A `|` in an error message must not forge a discount. The python->bash handoff is pipe
# delimited and `note` is the last field, so an unsanitised message shifted every field after
# it and printed `[discounted: ...]` on a run that nothing discounted — fabricating the exact
# disclosure this design leans on, in the one path where the gate is already unhappy.
printf '!FAIL upstream connect error | retry later\n' >"$API/783.jobs.json"
run_deploy "a pipe in an error message cannot fabricate a discount" \
                                 1 "could not read its jobs" "discounted" \
  "[{\"number\":783,\"databaseId\":783,\"status\":\"in_progress\",\"conclusion\":null,\"updatedAt\":\"$STALE\"}]"

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
# The decision logic lives in a `python3 -c '…'` block, so a single apostrophe anywhere inside
# it — including in prose in a comment — closes the quoted string early and the whole script
# dies with `syntax error near unexpected token '('`. This bit TWICE while writing TI-81, both
# times in a comment ("#762's record", "deploy.yml's 5 jobs"). The suite does catch it, but as
# 20 identical cryptic failures rather than one legible one, and the next person to add a
# sentence of prose will hit it again. Name the offending line instead.
# The verdict is only about deploys if the QUERY is scoped to deploys. Since [TI-80] added a
# push-triggered lint, a push to `main` produces a `Repo Checks` run, so the newest run on main
# is frequently not a deploy at all — an unscoped query would happily report a docs lint as
# "main's last deploy". The scoping lives in one `gh run list` argument, and until now nothing
# asserted it: the stub ignores gh's arguments everywhere else, so deleting `--workflow` left
# all 52 cases green. This asserts the argv, not the answer.
echo "query scoping"
: >"$STUB/argv"
GH_RUNS="$STUB/runs.json" GH_API_DIR="$API" GH_ARGV="$STUB/argv" PATH="$STUB:$PATH" \
  bash "$DIR/deploy-status.sh" >/dev/null 2>&1
argv=$(cat "$STUB/argv")
scope_bad=""
grep -q -- "--workflow deploy.yml" <<<"$argv" || scope_bad="the run query is not scoped to a workflow; saw: $argv"
grep -q -- "--branch main" <<<"$argv" || scope_bad="$scope_bad; the run query is not scoped to main; saw: $argv"
report "the run query is scoped to main's deploy workflow" "$scope_bad" "$argv"

# And the workflow argument must be the one the caller passed, not a hardcoded default that
# happens to match it.
: >"$STUB/argv"
GH_RUNS="$STUB/runs.json" GH_API_DIR="$API" GH_ARGV="$STUB/argv" PATH="$STUB:$PATH" \
  bash "$DIR/deploy-status.sh" some-other.yml >/dev/null 2>&1
argv2=$(cat "$STUB/argv")
arg_bad=""
grep -q -- "--workflow some-other.yml" <<<"$argv2" || arg_bad="the workflow argument is ignored; saw: $argv2"
report "the workflow argument is honoured, not hardcoded" "$arg_bad" "$argv2"

echo "python block quoting"
py_bad=""
py_start=$(grep -n "python3 -c '" "$DIR/deploy-status.sh" | head -1 | cut -d: -f1)
py_end=$(grep -n "^' 2>&1); then" "$DIR/deploy-status.sh" | head -1 | cut -d: -f1)
if [[ -z "$py_start" || -z "$py_end" ]]; then
  py_bad="could not locate the python block delimiters"
else
  offenders=$(awk -v s="$py_start" -v e="$py_end" "NR>s && NR<e && /'/ {print NR\": \"\$0}" \
              "$DIR/deploy-status.sh")
  [[ -n "$offenders" ]] && py_bad=$'an apostrophe inside the python3 -c block closes it early:\n'"$offenders"
fi
bash -n "$DIR/deploy-status.sh" 2>/dev/null || py_bad="$py_bad; deploy-status.sh does not parse"
report "no apostrophe inside the python3 -c block" "$py_bad" ""

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
