# The guard that passes its own test

**Slices:** BUG-66, BUG-59, BUG-60, BUG-55 (one session, 2026-08-09/10)

Four bug fixes, four PRs, eleven review rounds. The single most productive habit was mechanical and cheap: **delete the guard, re-run the test, confirm it goes red.** It found five defects that a green suite could not distinguish from a working fix — three of them introduced by the fix's own author, twice *inside the fix for a review finding about exactly this*.

This generalises past "write tests". A test written beside its fix encodes the fix's **path**. The question that matters is whether it encodes the **guarantee**.

## The five failure shapes

| Shape | Instance | Why the suite stayed green |
|---|---|---|
| **Vacuous** — the assertion is trivially true when the setup silently stops happening | BUG-66's `afterAll` asserted `createdEditors.filter(e => !e.isDestroyed)` was empty. Delete the `push` in the factory and `[].filter(...)` is `[]` | The registry emptied; the check passed harder |
| **Unfalsifiable** — nothing can observe the branch | BUG-55's `setLeaveDestination(null)` on the latched path. The `finishingTranscript` branch renders ahead of the confirm, so the cleared thing was never shown | Correct behaviour with *and* without it |
| **Dead** — an outer guard already covers it | BUG-60's `store()` try/catch. Every accessor already wraps the property access | Removing it changed nothing, by construction |
| **Threshold no-op** — the guard fires, but its bound makes it useless for the case it exists for | BUG-55's 5-minute commit deadline, against a finalise measured at ~1.31 × audio. Any meeting over ~4 minutes expired mid-pass | The code path was exercised; the *number* was wrong |
| **Path-not-guarantee** — the test walks the fix's happy path | BUG-59's `invalidateQueries` and its `App.tsx` wiring; BUG-60's user-visible message block; BUG-55's three ref assignments | Each deletable with the full suite green |

## What made each one visible

Not review-by-reading. Every one surfaced from an executable probe:

- **Vacuous** → delete the *setup*, not the assertion. Deleting the `afterEach` went red as designed; deleting the `push` one line away stayed green. A guard needs a non-emptiness assertion whenever its subject is a collection it also populates.
- **Unfalsifiable** → try to write the failing test. If you cannot construct one, the branch is not protecting anything *on that path* — either delete it, or find the path where it is observable. For BUG-55 both were true: unobservable during the sign-out park, genuinely load-bearing on the content-save await, which is where the guard finally went.
- **Threshold no-op** → check the constant against the system's own measured numbers, not against intuition. BUG-52 records `small.en` at ~2.3× realtime, run twice for diarization. That arithmetic was in the repo the whole time; the fix quoted "minutes on a long meeting" in a comment while choosing a value that covered short ones.
- **Path-not-guarantee** → mutate the production line, not the test. When the mutation stays green, the test is describing the code rather than constraining it.

## Two traps in the probing itself

**Restore *and rebuild*.** A mutation probe on the backend was restored from a backup but the assembly was not rebuilt, so the next full run tested the mutated binary. It reported a failure that did not exist and cost a wrong diagnosis before `dotnet build` explained it. If the probe touches compiled code, the restore is not complete until the build is.

**Re-run probes against the final file.** BUG-55's `stopSequenceRef` probe was recorded as "2 red". A third test was added afterwards, which made it 3. Probe evidence describes the file it ran against; edit the file and the evidence is stale.

## The corollary that cost the most

Two fixes-for-findings reintroduced the very defect they were fixing:

- BUG-60's review found the user-visible message untested; the fix wired `startCalendarConnect`'s result to a toast — and *that* branch had no test, for the same structural reason (every existing test took the other path).
- BUG-55's review found a dead confirm banner; the fix added a parked-state UI — untested, again.

**Fixing a review finding is when you are least likely to apply the finding to your own fix.** The finding names a shape; the shape is usually still available one line away.

## Reusable

1. A guard is not proven by a green test. It is proven by a red one when the guard is removed.
2. When the guard's subject is a collection the guard also fills, assert the collection is non-empty — otherwise emptying it passes.
3. If no test can be written that fails without the branch, delete the branch or move it to where it is observable. An unfalsifiable guard is documentation that lies.
4. A threshold is a claim about the system. Check it against measured numbers already recorded in the repo, and put the arithmetic in the comment so the next reader can re-derive it.
5. Restoring a probe on compiled code requires a rebuild; probe evidence is only valid for the file version it ran against.
6. Apply every review finding to the fix you write for it, before claiming the finding closed.
