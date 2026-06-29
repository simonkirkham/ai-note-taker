# 24-A — Bounded, retried projection-rebuild writes

**Slice:** 24-A · **PR** #200 · **Deployed** 2026-06-09 (deploy #490).

## What shipped

Replaced the rebuild's unbounded `Task.WhenAll` over ~290 upserts with a `BoundedWrites` helper: `SemaphoreSlim`-capped concurrency + per-write retry (exponential backoff + jitter). Delete-all calls wrapped in the same retry. First-try-on-cold-tables reliability without a second DynamoDB client.

## Non-obvious whys (the reason this doc exists)

1. **The 5s client timeout surfaces as `OperationCanceledException`, not `TimeoutException` — and it carries the SDK's *own* token, not the caller's.** `AmazonDynamoDBConfig.Timeout` is an HttpClient-level timeout; when it fires the SDK cancels with an internal token. So the transient check must be:
   - `ct.IsCancellationRequested` → genuine abort, never retry.
   - `ex is OperationCanceledException oce && oce.CancellationToken == ct` → caller's own cancellation, never retry.
   - any *other* `OperationCanceledException` → the per-op timeout → **retry**.
   The `TimeoutException` arm is essentially dead for this path; the OCE arm is the one that recovers the real failure. Tests must arm a *foreign-token* OCE, not just a throttle exception, or the actual 5s-timeout case is unverified (Hawk caught this gap in review).

2. **Retry subsumes a separate longer-timeout client — and a parallel store set was the wrong fix.** The phase's original AC prescribed injecting a higher-timeout `IAmazonDynamoDB` for the rebuild path. That conflicts with the test architecture: `ApiFactory` injects in-memory store doubles via DI, so a *parallel* longer-timeout store set would bypass the doubles and the rebuild tests couldn't substitute them. Retry is strictly more robust anyway (it also recovers throttles a longer timeout would not). Lesson: a spec that prescribes a *mechanism* (a second client) rather than an *outcome* (recover transient cancellations) can collide with the test seam — prefer outcome-level ACs.

3. **The note-card store has no delete path at all.** `INoteCardListStore` exposes only `Upsert`/`GetByNote`/`QueryAll` — no `DeleteAllAsync`. The rebuild upserts cards over stale rows and never prunes, so a deleted note's card survives a rebuild (pre-existing orphan gap, surfaced in review). Carried into 24-B's reconcile, which must add enumerate+delete-stale to the card store.

## Process note

Hawk's first pass was REQUEST CHANGES on exactly the under-tested OCE arm (#1) — the most important transient case had no test because the easy exception to fake is a throttle, not a foreign-token cancellation. When a retry helper's reason-for-existing is one specific exception, test *that* exception, not a convenient stand-in.
