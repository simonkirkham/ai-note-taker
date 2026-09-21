# BUG-88 — the two defects that mattered were both a fix that would have done nothing

**What the user hit:** the live transcript stopped dead seven minutes into a meeting and never came back. Nothing recovered it, and every later recording in the same app session inherited the same dead engine, so the only remedy was to quit and reopen the app — which nothing on screen said.

**What this doc is for:** not the fix. The fix is in [BUG-88](../phases/phase-bugs.md#bug-88--the-on-device-transcription-engine-can-hang-for-good-mid-meeting). This is about the three things that nearly shipped looking correct.

## 1. Twice, the fix would have been inert in the exact case it was built for

Both were introduced *while fixing the bug*, both passed every test, and both were invisible in a green suite.

| Round | The change | Why it would have done nothing |
| --- | --- | --- |
| 1 | Health-check a warm engine before reusing it | `isResponsive()` answered "not responding" for an engine still **loading its model** — not a fault. A second recording started during that load would have killed a healthy engine, leaked it, and shown a failure banner on a recording that was fine |
| 2 | Only replace an engine that has stopped answering | Self-defeating. The code's own theory is that the engine falls silent **because** abandoned requests accumulate on its serialising mutex. At the decision point only three are parked, so `GET /` still answers → "not jammed" → no replacement. **The headline fix would never have fired on a real hang**, and the log would have read exactly like "recovery wasn't needed" |

The round-2 one is the sharper lesson: **the fix contradicted the diagnosis in the same file.** The comment explaining the mechanism and the gate keying off the end state of that mechanism sat forty lines apart, both written in the same session, and neither reading flagged it. It was caught by a reviewer asking what the gate returns *at the moment it is consulted* rather than what it returns eventually.

**The manual check could not have caught it either**, which is what made it dangerous. `MANUAL-VERIFICATION` row 1 suspends the process — which suspends the HTTP acceptor too, producing *total* silence, the branch that works. It would have passed and certified the broken branch. Row 4b exists now to reproduce the **partial** jam: hold the inference mutex with concurrent requests while `/` still answers.

**The fix that survived** keys on the error signature at the throw site — an unbroken run of `TimeoutError` is a hang; a 500 or a bad body is an engine that is erroring, where a replacement returns the same thing. It does not depend on the jam having completed. And the name is **verified, not assumed**: a positive control fires a real request at a real socket that accepts and never answers, and pins the name the recovery keys on. If that name were ever wrong the whole fix would silently never fire.

## 2. One counter deciding two things let a single blip reinstate the bug

`failures` counted every cause; `hangFailures` counted only timeouts; both raced the same threshold, so the one counting everything always won. **One connection blip among the first three failures ended recovery for the whole recording** and stopped the step timer — so the thirty clean timeouts that followed never happened. That is the original bug, reached by a different road.

Splitting them is three lines. The reason to bother is the asymmetry: **replacing an engine you didn't need to costs one model load; failing to replace one you did costs the rest of the meeting.** Where the costs of the two errors differ by three orders of magnitude, a shared threshold is a bug waiting for an excuse.

The chosen value is a **floor, not a preference** — work the sequence `T,T,blip,T,T,T` through both counters and the run only completes on the sixth failure, so anything lower gives up before it. That arithmetic is now in the code, because a bare `× 2` reads as arbitrary and the next person shortens it.

## 3. Four specs passed for a reason other than the one they named

| # | Looked like it tested | Actually passed because |
| --- | --- | --- |
| 3 | Recovery, hammering, and the post-stop spin | They pushed audio **once**, so the idle guard halted the session by itself. Fixed by feeding audio continuously, as a meeting does |
| 1 | A disposed session not tearing down the next recording's engine | Disposal stops the step timer, so nothing could run whatever the recovery resolved to. Deleted; replaced with a test of the rule that was actually wrong |
| 1 | A 500 not being mistaken for a hang | It asserted `new Error(...).name !== 'TimeoutError'` — true by construction. Now feeds the real caught error and the exact object the throw site builds through the predicate itself |
| 1 | Mixed causes never triggering a restart | Its only assertion also passes if the run never got far enough to decide anything. Anchored by asserting the run **concluded** |

Three were caught by injecting a defect and noticing the wrong number of specs went red. **A spec that goes red is not yet evidence; a spec that goes red *and leaves its neighbours green* is.** Twelve defects were injected across this slice and each named which specs it should redden before it was run.

## 4. A push that succeeded and pushed nothing

The worktree was in detached HEAD. `git push origin <branch-name>` therefore pushed the **branch ref**, which was three commits stale, exited `0`, and printed nothing. Three rounds of review fixes sat local while `scripts/merge-gate.sh` reported `GREEN — safe to merge` on checks belonging to a commit from two rounds earlier.

The tell was not the push. It was that the gate went green **thirty seconds after a push**, which is faster than the checks can run. Comparing the PR's head sha against local `HEAD` took one command and showed a three-commit gap. Filed as [TI-105] (the gate) and [TI-106] (the push).

## The one habit behind all of it

Every defect above was found the same way, and none by reading code: **ask what the check prints in the state you want to exclude.**

- What does the health probe return for an engine that is *loading*? → "dead".
- What does `GET /` return at the moment we decide it is jammed? → "fine".
- What does `spawned === 0` prove if the run never reached a decision? → nothing.
- What does `git push` print when it pushes the wrong ref? → nothing.

This is the same shape as the four mechanisms in [a-mechanism-nobody-has-watched-work-is-not-working](a-mechanism-nobody-has-watched-work-is-not-working.md), with one addition that generalises further: **a fix can be inert in exactly the case it was written for, and look identical to a fix that was never needed.** Absence of the failure is not evidence the fix works — only watching it fire is, which is why BUG-88 stays open until the manual rows are ticked.
