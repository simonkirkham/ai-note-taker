---
slice: 5-C
title: Tag filter bar (TagIndex projection + GET /tags + E2E)
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

---

## Batch 2 learnings — E2E + frontend wire-up

### All projection DynamoDB reads must set ConsistentRead = true

DynamoDB's default read consistency is eventual. After a write returns a response, a subsequent read within a short window can return the pre-write value. E2E tests that write (via HTTP) then immediately navigate away and back (triggering a fresh `GET`) expose this regularly. Every `GetItemAsync`, `ScanAsync`, and base-table `QueryAsync` in every projection store must set `ConsistentRead = true`. The one exception is GSI queries — DynamoDB does not support consistent reads on Global Secondary Indexes.

**Affected stores fixed in this slice:** `DynamoDbNoteDetailStore`, `DynamoDbNoteCardListStore`, `DynamoDbNoteActionsStore`, `DynamoDbTodoListStore` (scan only), `DynamoDbFolderTreeStore`, `DynamoDbTagIndexStore`. Left unchanged: `DynamoDbTodoListStore.QueryActionIdsByNoteAsync` (GSI query).

**Prevention:** Add "all GetItem/Query/Scan calls set `ConsistentRead = true` (except GSI queries)" to the projection scaffold skill checklist so this is caught at implementation time, not at deploy time.

### Playwright's WaitForResponseAsync fires all handlers on the same response event

When N `page.WaitForResponseAsync(predicate)` tasks are active simultaneously, Playwright fires the `Response` event once per actual response — but all N registered handlers receive it. If two POST responses arrive for the same URL pattern, two tasks may both resolve to the *first* response, leaving the second unacknowledged. `Task.WhenAll` then completes before the second POST has actually returned.

**The correct pattern** for waiting on N distinct responses to the same URL is an atomic counter over a single `page.Response` event listener:

```csharp
int received = 0;
var done = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
page.Response += Handler;
await TriggerActionAsync();
await done.Task;
page.Response -= Handler;

void Handler(object? _, IResponse r)
{
    if (r.Url.Contains("/endpoint") && r.Request.Method == "POST")
        if (Interlocked.Increment(ref received) >= expectedCount)
            done.TrySetResult();
}
```

**Prevention:** Document this pattern in the page object base class so future multi-call helpers don't repeat the N-task mistake.

### Cleanup scripts must be updated alongside CDK table additions

When a new DynamoDB projection table is added to CDK (`notetaker-proj-foldertree`, `notetaker-proj-tagindex`), two local dev scripts must also be updated in the same commit:
- `docker/init-tables.sh` — creates the table in DynamoDB Local for integration tests
- `src/Api/Properties/launchSettings.json` — sets the `*_TABLE_NAME` env var for `dotnet run`

Missing these causes silent failures in local development (table not found) and integration tests that skip DynamoDB Local.
