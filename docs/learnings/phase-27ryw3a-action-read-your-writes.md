# RYW-3a — read-your-writes for the action flows

**Slice:** 27-RYW-3a · **PR** #263 · **Deploy** #554 green

Migrated the action flows (add/complete/reopen/delete) to async + read-your-writes, scaling the RYW-2 note pattern unchanged. The mechanical migration (append-only handler returns `action#id@version`, `action#` joins `MigratedPrefixes`, the actions read gates on the token) is well-trodden by now. Two findings worth keeping:

## 1. Migrating a flow can *close a latent prod double-count*, not just "be safe"

The PR's first rationale was wrong in a revealing way: "action feedback uses idempotent `TryRecord*`, so there's no double-count." Hawk refuted it.

- `DynamoDbActionItemFeedbackStore.IncrementAsync` is an **unconditional `ADD {counter} :one`** — *not* idempotent. `TryRecordCompletionAsync`/`TryRecordDeletionAsync` only gate on *provenance existence* (was the action AI-suggested), then increment unconditionally.
- The Projector Lambda has processed `action#` streams since RYW-1. So **before** this slice, prod ran `ApplyActionItemEventsAsync` **twice** per complete/delete — once inline, once in the projector — double-incrementing the feedback counter.
- Removing the inline write makes the projector the **sole** writer → one increment. The slice *fixes* a latent double-count; it doesn't merely avoid introducing one.

**Lesson:** while a flow is still inline *and* the projector is enabled, every non-idempotent projection write (increment counters) is silently doubling in prod. The incremental migration's per-flow inline-removal is what closes each one. Don't reason "is the new path safe in isolation" — reason "what was the inline + projector pair doing *together* before I removed the inline half." (The remaining suggestion-counter double-count on the still-inline analysis flow closes in RYW-3c.)

## 2. `CommandInstrumentation.RunAsync(... async () => …)` infers `Task<int>` — cast the token return to `long`

`return history.Count + envelopes.Count;` inside the instrumentation lambda makes the lambda infer `Task<int>`, which fails `CS0029` against the `Task<long>` handler contract — `int`→`long` widening does **not** cross the `Task<>` generic boundary. Cast at the return: `return (long)(history.Count + envelopes.Count);`.

A sibling method declared `async Task<long>` (e.g. `ExecuteAppendAsync`) needs *no* cast — there the `int` return widens implicitly to the method's declared return type (a different conversion rule that *does* apply). So the cast is load-bearing in the lambda form and redundant in the method form; the asymmetry is real, not an oversight.

## 3. `gatedRead` extracted to a shared client helper

The RYW-2 `gatedRead` (attach `If-Consistent-With`, bounded `stale` retry, clear-on-fresh) lived privately in `notes.ts`. 3a needed the identical loop for actions, so it moved to `web/src/api/gatedRead.ts` and both modules import it — behaviour-preserving (same `STALE_RETRIES=2`, `300ms`). Each future RYW flow (folders/workspaces in 3b) reuses it rather than re-implementing.
