# Phase 2-E Learnings — Projection Rebuild

## What we built

`POST /admin/projections/rebuild` — an admin endpoint that resets both projection tables and replays every event in the store to reconstruct the read side from scratch. `IEventStore` gained `ReadAllStreamsAsync()`, both projection stores gained `DeleteAllAsync()`, and `NoteDetailProjection` gained `GetAllDetails()` to enumerate surviving notes after replay.

## What worked well

**The fold-then-upsert pattern is clean.** After clearing both stores, `ProjectionRebuildHandler` feeds all events through the in-memory projections (which already handle every event type correctly, including `NoteDeleted`), then upserts only the surviving entries. Deleted notes are automatically excluded because `NoteDeleted` removes them from `_items` during replay — no special-case logic needed.

**`begins_with(SK, :v)` as the event-row filter.** The DynamoDB event store uses `SK = "META#stream"` for version rows and `SK = "v00000001"` etc. for events. Scanning with `begins_with(SK, :v)` cleanly excludes meta rows without needing a separate attribute. This is a consequence of the SK design chosen in Phase 1 paying off.

**Two `InMemoryEventStore` implementations exist** (one in `Specs/EventStore/`, one in `ApiIntegration/`). Adding `ReadAllStreamsAsync` to the interface required updating both. The Specs one is structurally identical; the duplication isn't ideal but is consistent with the existing pattern. A shared test helper package could eliminate this in future.

## What was surprising or non-obvious

**`BatchWriteItemAsync` can return `UnprocessedItems` under DynamoDB throttling.** The implementation doesn't retry them — a silent drop. For a rebuild of a small learning dataset this is fine, but a production rebuild would need a retry loop. Hawk flagged it; deferred given the learning context.

**`using Domain.Notes;` in `ProjectionRebuildHandler` was dead code.** The handler only uses `NoteTitleListProjection` and `NoteDetailProjection` from `EventStore.Projections`, not any domain types directly. Hawk caught this on review; fixed before merge.

**DynamoDB `FilterExpression` is a post-read filter.** `ReadAllStreamsAsync` scans the entire events table and then discards META rows via `FilterExpression`. This consumes read capacity for every row, not just event rows. For a typical event sourcing dataset where meta rows are a small fraction, this is negligible. Acceptable for an infrequent admin operation.

**`Task.WhenAll` for concurrent upserts has a throughput ceiling.** Firing all upserts in parallel is fast in development but could hit DynamoDB provisioned throughput limits on a large dataset. Batching upserts in groups of 25 would be more robust. Out of scope for this slice.

## Workflow notes

- Backend-only slice; Stylist skipped correctly.
- One Hawk finding (dead using) fixed before merge — clean one-round review.
- Feature branch `slice/2-e-projection-rebuild`, PR #12 merged via squash.
- **Phase 2 is now complete.** All five slices (2-A through 2-E) are Done.
