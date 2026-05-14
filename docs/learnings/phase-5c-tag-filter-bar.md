---
slice: 5-C Batch 1
title: TagIndex projection + GET /tags
date: 2026-05-14
author: Scribe
---

## What was built

A new `TagIndex` projection that maintains a DynamoDB table (`notetaker-proj-tagindex`) with one row per tag-note combination (PK: `Tag`, SK: `NoteId`). A `GET /tags` endpoint groups these rows by tag and returns counts and note IDs ordered by note count descending.

## Key learnings

### Composite PK/SK on a projection table requires both keys in batch deletes

`DeleteAllAsync` and `DeleteByNoteAsync` both scan and then batch-delete. Because the table has a composite key (`Tag` + `NoteId`), both attributes must appear in each `DeleteRequest.Key` — a simple PK-only projection scan would fail at the delete step. The `ProjectionExpression = "Tag, NoteId"` scan ensures both keys are present in the results.

### Scan with FilterExpression is the right trade-off for NoteDeleted cleanup

The task says: "use a scan with FilterExpression on `NoteId`" because you can't query by SK alone without knowing all PKs. With a small projection table this is correct. No GSI needed. `DeleteByNoteAsync` scans for all rows where `NoteId = :noteId` and batch-deletes them.

### `NoteId` is stored as `ToString("N")` (no hyphens)

The projection spec and DynamoDB store both use `Value.ToString("N")` for consistency with the in-memory projection. The `N` format (32 hex digits, no hyphens) matches what `TagIndexProjection` emits during rebuild.

### `ITagIndexStore` must be a singleton registered before NoteCommandHandler

`NoteCommandHandler` now takes `ITagIndexStore` as a constructor parameter. In tests, `ApiFactory` removes the DynamoDB implementation and substitutes `InMemoryTagIndexStore` — registration order matters; the in-memory store must be added after `RemoveAll`.

### Test isolation: shared `IClassFixture<ApiFactory>` accumulates state

The `GetTags_ReturnsEmptyWhenNoTags` test passes in isolation but would fail if another test has already added tags to the shared factory instance. The current test order happened to be safe, but future refactoring should be aware that "starts empty" assertions may need a dedicated isolated class.

### ProjectionRebuildHandler must include DeleteAllAsync before rebuild

The rebuild path calls `tagIndexStore.DeleteAllAsync` before replaying events, ensuring the tag index is fully rebuilt from the event stream rather than accumulating stale entries.
