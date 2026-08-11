# A mechanism nobody has watched work is not working

## The failure mode

Something is written, reviewed, and merged. It is *believed* to work because it looks right and nothing complained. But nobody has ever pointed at an output it produced — a log line, a run, an emitted event, a refusal. It has never actually executed, and it does not work.

Review cannot catch this class. All four cases below **passed review**. Two passed it six times.

## Four instances, one day (2026-08-10)

| What | Believed | Actually |
| --- | --- | --- |
| `e2e.yml` on-demand runner | The documented way to prove a flake fix without deploys ([CLAUDE.md](../../CLAUDE.md)) | Never parsed. `on:` was never read, so `workflow_dispatch` never registered and **all 162 runs were push-triggered red X's**. Unusable from the day it was added ([TI-69]) |
| Its AWS account guard | Refuses to wipe the event store if pointed at the wrong account | Scoped to a step that never runs the script. Wiped 14 tables **unverified** for 3 days while the repo variable it reads was set ([TI-69]) |
| `recordRumEvent`, 6 slices' worth | Six shipped user signals | Custom events are **DISABLED** on the RUM monitor. None has ever emitted ([TI-67]) |
| 51-B's pinned-tab probe | Reviewed across six rounds | **Crashed on its first ever execution**, red-gating the deploy; the slice merged and shipped nothing while the hand-back said Done |

## Why it matters

The failure is silent *and* self-concealing. A workflow that never parses reports its failure against unrelated pushes. A guard that never runs prints nothing. A telemetry call that never emits looks identical to one with no traffic. So the absence of complaints is not evidence — it is the symptom.

Worse, each one degraded a *safety* mechanism, and the belief that it existed is what removed the pressure to check.

## The rule

**Before recording anything as working, name the observation that proves it.** Not the code, not the review, not a green build that never exercised it — the output.

- Added a guard? Make it **fire once** and read the line. `Target account … matches E2E_TEST_ACCOUNT_ID.`
- Added telemetry? Query the sink, in the environment that matters, and find the event.
- Added a workflow, script, or helper? **Run it.**
- Cannot observe it? Then it is unverified — say so plainly rather than reporting it as done.

## The checkable test

> *Can I point at something this produced?*

If the honest answer is "it should work" or "it was reviewed", it is unverified. On 2026-08-10 that question, asked once, was the entire difference between finding three defects and shipping past all of them.

## Where the cost lands

Verifying costs minutes. The `e2e.yml` defect went 3 days and 162 false red marks, and was first written up with a **confidently wrong cause** inferred from run metadata — because the run list can describe runs, and the thing that never happened leaves none. See the 2026-08-10 entry in [`_minor-log.md`](_minor-log.md).

## Distinct from "test it"

This is not a call for more tests. Three of the four had tests, or were themselves test infrastructure. It is narrower: **the first execution of a new mechanism must be watched by a person, once.** After that, tests carry it.

---

# The second sub-class: the check that runs and cannot report the condition

Collected 2026-08-10/11 across two sessions. Quotes marked _(verbatim, peer session "Bugs")_ are reproduced unedited.

The four instances above are all *"the mechanism never ran"*: `e2e.yml` (never parsed, 162 red X's), the AWS account guard scoped to a step that never runs, `recordRumEvent` (custom events DISABLED — now [TI-67]), 51-B's probe that crashed on first execution. The instances below are a **new sub-class**: *"the check runs, answers confidently, and cannot report the condition it is asked about."* The first kind is silent and turns up in an audit; the second answers, and answers the same thing every time, so it turns up only when someone deliberately tests the instrument.

## The instances

1. **A contention probe blind to most of the contention.** `pgrep -fc 'vitest run'` was passed between sessions as the pre-commit guard. The hook runs xUnit too: a real measurement found 7 vitest processes alongside 3 `dotnet test` and 28 `MSBuild`. A session polling only vitest sees a quiet box while 31 backend processes fill it.

2. **The same probe could never return zero.** `pgrep -fc 'qqq-isolated-nonsense-qqq'` returns **1** on an idle machine; `pgrep -fa` names the Claude Code wrapper shell, whose cmdline carries the entire eval'd command text including the pattern. So `count > 0 → wait` waits forever on an idle box. Inflation is **not constant** (3 matches on a 3-session box: real 31, reported 34), so "subtract one" fails too. It is an artefact of invocation, not of pgrep — the identical line inside `.githooks/pre-commit` returns 0 correctly, because git invokes the hook as a bare path. **Both attempts to verify this walked into the same confounder:** a control `pgrep` left in the same command block puts the needle back on the wrapper's cmdline.

3. **A gate on a field this repo never sets.** A session was about to gate merges on `gh pr view --json reviewDecision`. Hawk posts its verdict as a PR **comment** (agent-roles.md, Hawk Output), so `reviewDecision` is empty on every PR here by design. The gate would not have errored — it would have waited indefinitely, looking like a legitimate wait.

4. **An approval that named an older commit.** PR #462 merged on a verdict given at `01a799f0` while the head was `fa248737`. The unreviewed delta was exactly the two nits the reviewer itself supplied (`pr.yml` retry-loop `break`; an ADR blockquote), and CI *was* green on the true head — but the approval did not cover what merged. **An approval names a commit; folding in the reviewer's own suggestions invalidates it exactly like any other commit.**

5. **The verdict that never reached the PR** _(verbatim, peer session "Bugs")_:

   > Two PRs were held for review and neither carried a Hawk verdict comment, though Hawk had demonstrably run — it reported into its parent agent's transcript instead of onto the PR, so the only record of the approval was in a place the merge gate cannot read. The coordinating session believed it had a review it could not point at, and the briefing that caused it never said where the verdict had to land.

6. **The remedy shipped unverified.** The fix for (5) was "instruct the reviewer to post with `gh pr comment`" — and that instruction had the identical flaw it was correcting: **nothing checked the post had worked.** Now requires the comment to come back from `gh pr view --json comments` before the PR is reported ready.

7. **A claimed-live poll that was dead.** A background deploy poll was started specifically so a promised ping would be "backed by a real job, not an intention". The Claude Code process later exited and killed it, silently — no completion record. The peer got the deploy result only because it was re-checked directly on the next turn. `⏳ STILL RUNNING` was asserted once and then treated as the state of the world, which is the failure CLAUDE.md `### When NOT to hand back` rule 4 already names.

8. **The durability of this very file.** It was written to a session scratchpad with the stated reason that it "cannot evaporate if context compacts". The process exited and the scratchpad was cleaned; the file was gone within the hour, and survived only because its content was still in the writing session's context. **A store nobody has watched survive a restart is not a store.** Anything meant to outlive the session belongs in the repo, in the same turn it is written.

## The direction matters _(verbatim, peer session "Bugs")_

> A stale record fails visibly: inspect it and the dates disagree. A missing record fails by looking exactly like work that has not happened yet — and the honest response to that, wait and check again, is indistinguishable from the correct one, so the session waits instead of investigating.

Consequence: **"no verdict comment" means unknown, not un-reviewed.** The two need different responses and cannot be told apart from outside.

## Operationalising the test — a four-part bar

The general test is a habit, and a habit cannot be failed. Where CI structurally cannot cover the change ([TI-73] and [TI-64] both touch `.githooks/**`, which `pr.yml` paths-ignores, so a green PR proves nothing), it has to become an acceptance bar someone can fail. Four parts, contributed by the peer session driving [TI-73]:

| # | Demonstrate | Catches |
| --- | --- | --- |
| 1 | **Red** — reproduce the failure before the change | A fix for a problem that was not there |
| 2 | **Green** — the same case passing after it | The ordinary claim |
| 3 | **Injected defect** — break it deliberately, watch the guard bite, revert | A guard that looks live and is inert |
| 4 | **The bounded deadline actually firing** | A timeout that can never elapse — BUG-56 shipped a ready-deadline at 75 s above a 60 s kill: dead code that reviewed as a safety net |

Parts 3 and 4 are the ones that get skipped, and they are the only two that test the **instrument** rather than the outcome.

## What to add to the pipeline

- Reviewer posts its verdict to the PR; the driver must **see the comment come back** before reporting ready. Having run the command is not evidence.
- Never gate on `reviewDecision` in this repo — read the comment body.
- Re-review the delta when anything is pushed after an approval, including the reviewer's own nits.
- Prefer an instrument that cannot be blind by omission (load average) over one that must enumerate what it looks for (process names).
- Re-verify a background job still exists before relying on it; a verdict backed by a dead job is false the moment it dies.
- Persist anything meant to outlive the session **to the repo**, not to a scratchpad.
- **The general test, which caught all eight and which reading caught none of:** run the check, then ask whether its answer was *capable* of being wrong. A check that cannot return the failing value is not a check.
