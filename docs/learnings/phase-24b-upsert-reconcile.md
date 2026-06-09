# 24-B — Upsert-and-reconcile projection rebuild

**Slice:** 24-B · **PR** #202 · **Deployed** 2026-06-09.

## What shipped

Rebuild stopped wiping projections first. Per user-facing store: upsert the rebuilt set (bounded+retried), then delete only rows present in the table but absent from the rebuilt keep-set. A fault now leaves stale-but-present rows, never missing ones. Closed the note-card orphan gap and the `NoteSearchView` tombstone divergence in the same pass.

## Non-obvious whys

1. **Reconcile must mirror each projection's own live-delete semantics — they are not uniform.** Per `NoteDeleted`: Title/Detail/TagIndex/CalendarLink projections *remove* the row and the live path hard-deletes → reconcile prunes. The **NoteCard** projection deliberately *keeps* a `Deleted=true` row and the live path keeps it → reconcile must **retain** it. **NoteSearchView** keeps `Deleted=true` in the projection but the live path *hard-deletes* → the handler filters `!Deleted` out of the upsert set so reconcile prunes the tombstone. Getting the keep-set wrong per-store either drops a live row or leaves a tombstone. There is no single rule; you check each projection against its live path.

2. **An enumerate used for a reconcile diff must paginate, or it silently under-deletes.** A single DynamoDB `Scan` caps at 1MB. The new `QueryAllAsync` enumerates were the diff's "existing" side; an unpaginated scan past 1MB makes reconcile blind to stale rows beyond page 1 — the exact silent-correctness failure the slice exists to remove. Every reconcile enumerate loops on `LastEvaluatedKey` (Hawk caught Detail + Card single-scanning).

3. **Feedback projections stay delete-then-rebuild on purpose.** Tag/ActionItem feedback aggregates are monotonic — the live path never deletes an aggregate row (deletions are tracked as counters), and aggregates are recomputed from immutable suggestion events, so the rebuilt set always covers every historical key. Upsert-then-reconcile buys nothing there; delete-then-rebuild is simpler and the wipe precedes the `allEvents` read so a read fault can't leave them empty.

4. **The empty-keep-set wipe risk is closed upstream, not here.** Reconcile deletes `existing − keep`; an empty keep-set would delete everything. That can only happen if `ReadAllStreamsAsync` returned nothing — but it paginates and propagates throttles, so a transient event-store read throws *before* reconcile rather than yielding a false-empty keep-set.

## Process note

Projection stores are tested via in-memory doubles (Api.Integration) + post-deploy smoke — never DynamoDB Local. So the reconcile tests live there, and a fault-injecting double proves the abort-leaves-data-intact property. The real `Scan`/`DeleteItem` paths mirror existing proven methods and are verified by the post-deploy rebuild. First Hawk pass also caught a test that asserted the right end-state but never exercised the reconcile path (the live delete had already removed the row) — when a test names a mechanism, make sure the seed forces that mechanism to run.
