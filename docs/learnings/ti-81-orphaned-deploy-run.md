# An orphaned deploy record, and the four things that made the fix trustworthy

**TI-81** · PR [#469](https://github.com/simonkirkham/ai-note-taker/pull/469) · squash `4727672f` · deploy #770 · Hawk approved at round 5, no must-fix.

Nobody could merge anything for the best part of an hour. The check that answers "is it safe to merge?" reported a deploy still running that had actually finished successfully 51 minutes earlier, and there was no way to clear it — GitHub never reconciles a run record whose runner died, and the gate blocks on any deploy in flight by design. It clears on its own eventually; the workarounds it invites in the meantime (merge past the gate, cancel a run that succeeded) are both worse than waiting.

The fix and its evidence are in [TI-81 in the archive](../technical-improvements-archive.md#ti-81-an-orphaned-run-record-blocks-the-merge-gate-for-tens-of-minutes). This doc keeps only the parts that were not obvious and are reusable.

## 1. The discriminator had to be measured, and was

The whole fix rests on telling "orphaned" from "slow but alive". Both look identical in the run record — `in_progress`, with jobs that have all finished.

The distinction was going to be an allow-list of terminal-and-successful jobs. That is only safe if a job that has been *dispatched but not started* still has a record. If job records were created at dispatch, there would be a window in which a live deploy's next job has no record at all and the run reads exactly like an orphan.

So it was checked against reality rather than reasoned about. **Job records are created at eligibility, not dispatch.** On the incident run, `deploy-production.created_at` equalled `deploy-test.completed_at` **exactly** — the window is ~0s. A job waiting for a runner carries a `queued` record throughout; the largest gap measured across 25 runs was **56 seconds**.

That measurement is what makes the allow-list safe. Without it the fix would have been a plausible guess that happened to hold, which is the shape this project's guardrails exist to catch — see [agreement is not evidence](a-mechanism-nobody-has-watched-work-is-not-working.md).

## 2. "Terminal" quietly admits `failure` — and this trap was walked into

The natural phrasing for the condition is "all jobs terminal". `failure` is terminal.

This was not spotted by reading the code. It was found by **injecting it**: the script, so amended, reported a deploy whose `deploy-production` had **failed** as safe to merge, and exited 0. A merge gate waving a merge onto a broken `main`, from a one-word looseness in a condition.

The strict form — `status == completed` **and** `conclusion == success` — is load-bearing, and the test that pins it (`a failed job is never discounted, however stale the record`) is not ceremony.

The generalisation: a word like *terminal*, *done*, *finished*, or *settled* names a **set**, and the set is almost always wider than the intent. Enumerate the members before using the word in a guard.

## 3. The suite's positive controls are real, not asserted

The project's standing bar is "inject the defect and watch the guard bite". This is one of the few places it was actually met end to end.

**Four permissive-direction defect injections all went red, and three of them flipped an exit code from 0 to 1** — a genuine false-green caught, not merely a changed message. That distinction matters: a suite that only ever detects reworded output proves it is reading the script, not that it would stop a bad merge.

Two corrections worth carrying:

- **Re-run every injection after every change.** Three injections exist because review found guards shipping untested — and in each round the defects were in code the *previous* round had just added. An injection result is evidence about the code that existed when it ran, and nothing more.
- **A case can pass on the wrong arm.** The re-running-run case looked like a test of the job clock; neutering the job check left it green, because the freshness clause was holding it. A second case (`a slow run still executing is not orphaned, however stale its record`) was added to remove that cover. **Which clause a passing test is actually exercising is not visible from the fact that it passes.**

## 4. A refusal worth preserving: the tidy-up that would have created a green

```python
job_ages = [age_minutes(j.get("completed_at")) for j in jl]
if any(a is None for a in job_ages):
    return "block", "... a job carried no readable completed_at ..."
job_age = min(job_ages)
```

`min()` over a list that might contain `None` is exactly the shape a linter, a reviewer, or a future tidy-up wants to rewrite as `min(a for a in job_ages if a is not None)`.

That "harmless cleanup" would **silently drop** the job that never reported a completion and compute the minimum over the rest — turning a run that cannot be shown to have finished into a **green**. The explicit `any(... is None)` refusal is the guard; the `min()` is downstream of it.

There is a test pinning this (`a job with no completed_at cannot establish that the run finished`). **A defensive check that looks like a redundant one needs a test whose name says why it is not** — otherwise the next person removes it, correctly, by the standards they can see.

## 5. Same shape as TI-88

[TI-88](merge-gate-verdicts-expire.md) is a merge waved through as safe and refused three seconds later, on a mergeability flag GitHub had not yet recomputed. Different gate, different script, same shape: **a gate reporting a state that was true a moment ago and is not true now.**

TI-81 is a stale *run* record, TI-88 a stale *mergeability* flag. The reusable part is the shape — and the property both fixes need is that a verdict can name **what it was computed against**, so a later step can tell it has expired.

## Follow-up

[TI-89](../technical-improvements.md#ti-89-the-merge-gates-self-test-blames-the-merge-gate-when-the-machines-date-command-is-the-problem) — off GNU coreutils, this suite fails on nine cases whose messages accuse the merge-gate logic when the machine's `date` is the problem. It also records the one known limit that stays: a `skipped` job blocks the discount, which is the allow-list failing closed on purpose.
