# BUG-17 — Concurrent multi-word tag add drops a tag (append retry on conflict)

**Shipped:** PR #217, deploy #506, 2026-06-10. Resolves the long-running flaky `TagsJourney` E2E.

## What it was

A "flaky test" that was actually a real backend lost-write. A space-separated multi-tag add (`"1:1s Bill"`) fanned out into two concurrent `POST /notes/{id}/tags` on the same note stream; the second append lost the optimistic-concurrency check and was silently dropped.

## The non-obvious chain (four layers, each individually reasonable)

| Layer | Behaviour | File |
|-------|-----------|------|
| Frontend | multi-word tag → unawaited loop firing two concurrent POSTs | `web/src/components/NoteView.tsx` |
| Backend | `ExecuteAsync` read→rebuild→handle→append with **no retry** on `ConcurrencyException` | `NoteCommandHandler.cs` |
| Frontend | `tagNote()` lists `409` as an accepted status → the dropped add is **silent**, pill stays | `web/src/api/tags.ts` |
| Backend→Frontend | removing the phantom tag → 404 → `untagNote` throws → optimistic **rollback re-adds the pill** | `Note.cs` → `NoteHandlers.cs` → `useTagMutations.ts` |

No single layer looks buggy in isolation. The bug only exists in their interaction, which is why it read as "flaky" for weeks.

## Lessons

1. **A change-independent flake is a real bug, not a test problem.** The decisive clue: the test failed on a **docs/CI-only PR (#213)** that touched zero application code. A failure that can't be caused by the diff is environmental *or* a latent race — here, a race. Reruns "fixed" it only by reshuffling timing.
2. **Reproduce deterministically before fixing a race — don't iterate on the E2E.** A `ConflictingEventStore` test double that forces a one-shot `ConcurrencyException` on the next append turned a timing-dependent E2E flake into a deterministic `Api.Integration` test. That test is the spec; the E2E is just the post-deploy proof.
3. **Retry-on-conflict belongs in the command handler, not the aggregate.** The aggregate stays pure; the handler owns the read→rebuild→handle→append cycle, so the retry (re-read the stream, re-run the pure command on the fresh version, re-append) wraps that cycle there. Tag commands are idempotent on a fresh version (`TagNote` no-ops a duplicate, `UntagNote` no-ops a missing tag), which is what makes the re-run safe.
4. **`BoundedWrites.WithRetryAsync` is the wrong tool for this.** It retries *transient DynamoDB faults* and cannot re-read/re-run the handler between attempts. Conflict-retry needs a fresh read each attempt, so a small inline loop in the handler is correct — not reuse for its own sake.
5. **Bound the retry and keep it cheap on the interactive path.** 4 attempts, 20/40/80ms exponential backoff + ≤20% jitter = ~170ms worst case; the final attempt rethrows so a *persistent* conflict still surfaces as 409 (BUG-4 behaviour preserved).
6. **A flake in the post-deploy gate is everyone's problem.** While unfixed it blocked unrelated CI/docs deploys (it failed #501 three runs; other sessions kept re-running #505). Fixing the root cause unblocks the whole team, not just the one slice.

## Defence-in-depth

`untagNote()` now treats 404 **and** 409 as success — removing a tag the server doesn't have matches user intent and must never roll back into a phantom pill. Mirrors `tagNote()` already accepting 409.

## Deferred

`ActionItemCommandHandler` interleaves projection writes with its append, so it wasn't given the same retry. Lower risk (streams keyed per action item, not a shared hot stream like a note's tags). If conflict-retry is wanted there, generalise into a shared `AppendWithRetry` helper rather than duplicating — noted in `technical-improvements.md`.
