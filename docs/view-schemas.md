# View (Projection) Schemas

Canonical shapes for every read projection. Three layers:

- **C# DTO** — the typed record returned from the API (`src/Api/`) and held in the projection store.
- **Wire JSON** — what the React frontend actually receives.
- **Storage row** — how the projection is laid out in DynamoDB.

Companion to [`event-model.md`](./event-model.md) (which projections exist and which view consumes them) and [`event-schemas.md`](./event-schemas.md) (the input events). This document is the reference for *building* the projections in `src/EventStore/Projections/`.

---

## Principles

- **Projections are derived state.** Anything here can be torn down and rebuilt from the event stream. Never the source of truth.
- **One read model per query.** Each projection is shaped for exactly one consumer. Denormalise freely — joining client-side or in the API defeats the point.
- **Denormalised joins are projection-side.** If `TodoList` needs the parent note's title, the projection subscribes to `NoteRenamed` and updates its rows. The API does not call back to other projections at read time.
- **Per-projection table.** Each projection gets its own DynamoDB table. Easier to drop + rebuild in isolation; clearer IAM boundaries.
- **No business logic.** Projections only fold events into a shape. Validation, decisions, and rules live on the aggregate.

---

## Projections

### 1. `NoteTitleList`

**Consumed by:** Home view sidebar.
**Source events:** `NoteCreated`, `NoteRenamed`, `NoteDeleted`.

```csharp
public record NoteTitleListItem(
    NoteId NoteId,
    string Title,
    DateTimeOffset LastModifiedAt);

// Read API returns:
public record NoteTitleListView(
    IReadOnlyList<NoteTitleListItem> Items);
```

Items returned ordered by `LastModifiedAt` descending. Soft-deleted notes are filtered out at read time (or pruned from the table on `NoteDeleted` — see "Soft delete handling" below).

**Wire JSON:**
```json
{
  "items": [
    { "noteId": "7f3a...", "title": "Bill 1:1",        "lastModifiedAt": "2026-04-23T09:15:01Z" },
    { "noteId": "8a2b...", "title": "API integration", "lastModifiedAt": "2026-04-22T16:40:11Z" }
  ]
}
```

**Storage row** (table `notetaker-proj-notetitlelist`):

| PK (NoteId)   | Title       | LastModifiedAt        | Deleted |
|---------------|-------------|-----------------------|---------|
| `7f3a...`     | Bill 1:1    | 2026-04-23T09:15:01Z  | false   |

**Event handlers:**
- `NoteCreated` → upsert row, `Title = ""`, `LastModifiedAt = OccurredAt`
- `NoteRenamed` → update `Title`, `LastModifiedAt`
- `NoteDeleted` → set `Deleted = true` (or hard-delete the row)

---

### 2. `NoteCardList`

**Consumed by:** Home view's Notes section. The richest projection — fully denormalised cards.
**Source events:** all `Note*` events plus `ActionItemAdded`, `ActionItemCompleted`, `ActionItemReopened`, `ActionItemEdited`, `ActionItemDeleted`.

```csharp
public record NoteCardActionItem(
    ActionId ActionId,
    string Description,
    bool Completed);

public record NoteCard(
    NoteId NoteId,
    string Title,
    string ContentPreview,         // first ~200 chars of Content, no markup
    IReadOnlyList<string> Tags,
    IReadOnlyList<NoteCardActionItem> ActionItems,
    int OpenActionCount,
    int TotalActionCount,
    DateOnly? Date,
    DateTimeOffset CreatedAt,
    DateTimeOffset LastModifiedAt);

public record NoteCardListView(
    IReadOnlyList<NoteCard> Cards);
```

**Wire JSON:**
```json
{
  "cards": [
    {
      "noteId": "7f3a...",
      "title": "Bill 1:1",
      "contentPreview": "Met with Bill re: API integration. He'll send specs Friday.",
      "tags": ["1:1s", "Bill"],
      "actionItems": [
        { "actionId": "9c1d...", "description": "Fill out the form", "completed": false },
        { "actionId": "a2e4...", "description": "Send agenda",       "completed": true  }
      ],
      "openActionCount": 1,
      "totalActionCount": 2,
      "date": "2026-04-21",
      "createdAt": "2026-04-23T09:14:22Z",
      "lastModifiedAt": "2026-04-23T09:15:01Z"
    }
  ]
}
```

**Storage row** (table `notetaker-proj-notecardlist`, one row per note):

| PK (NoteId) | Title    | Content         | Tags (SS)        | ActionItems (JSON list) | CreatedAt | LastModifiedAt | Deleted |
|-------------|----------|-----------------|------------------|--------------------------|-----------|----------------|---------|
| `7f3a...`   | Bill 1:1 | Met with Bill…  | `["1:1s","Bill"]`| `[{"actionId":...},...]` | …         | …              | false   |

`OpenActionCount` / `TotalActionCount` / `ContentPreview` are **derived at read time** from the stored fields — no need to store separately. Keeps writes simpler.

**Event handlers:**
- `NoteCreated` → upsert row, blank fields, set `CreatedAt` / `LastModifiedAt`
- `NoteRenamed` → update `Title`, `LastModifiedAt`
- `ContentEdited` → update `Content`, `LastModifiedAt`
- `NoteTagged` → add tag to set, update `LastModifiedAt`
- `NoteUntagged` → remove tag from set, update `LastModifiedAt`
- `NoteDateSet` → update `Date`, `LastModifiedAt`
- `NoteDeleted` → set `Deleted = true` (filter in queries)
- `ActionItemAdded` → append to `ActionItems`, `LastModifiedAt`
- `ActionItemCompleted` → mark item `completed = true`
- `ActionItemReopened` → mark item `completed = false`
- `ActionItemEdited` → update item description
- `ActionItemDeleted` → remove from `ActionItems`

---

### 3. `NoteDetail`

**Consumed by:** `NoteEdit` view (the editable note screen).
**Source events:** all `Note*` events for a single `NoteId`.

```csharp
public record NoteDetail(
    NoteId NoteId,
    string Title,
    string Content,
    IReadOnlyList<string> Tags,
    DateOnly? Date,
    DateTimeOffset CreatedAt,
    DateTimeOffset LastModifiedAt,
    string? TranscriptText,                       // raw speech-to-text; null until a transcript is completed
    string? Summary,                              // AI Final notes; null = never analysed (a normal empty state, not an error)
    IReadOnlyList<string> DiscussionPoints,       // [] when none
    IReadOnlyList<string> Decisions,              // [] when none
    string? SummaryModelId,                       // attribution: which model wrote the summary
    string? SummaryPromptVersion,                 // attribution: which prompt version produced it
    long Version);                                // current stream sequence number
```

`Version` is returned so the client can include it on the next command for optimistic concurrency (see [`dynamodb-event-append`](../dot-claude/skills/dynamodb-event-append/SKILL.md)).

The **Final notes** fields (`summary`/`discussionPoints`/`decisions`/`summaryModelId`/`summaryPromptVersion`) are the AI's structured artifact, folded from the latest `AnalysisSummaryRecorded` (latest wins). A note that has **never been analysed** has `summary: null` and empty lists — this is a normal "no final notes yet" state, *not* an error, and is distinct from a failed analysis run (which the API surfaces as a 503 and the UI shows as an error). `content` is the user's own Quick notes and is **never** written by analysis from Phase 15-A onward.

**Wire JSON:**
```json
{
  "noteId": "7f3a...",
  "title": "Bill 1:1",
  "content": "Met with Bill re: API integration. He'll send specs Friday.",
  "tags": ["1:1s", "Bill"],
  "date": "2026-04-21",
  "createdAt": "2026-04-23T09:14:22Z",
  "lastModifiedAt": "2026-04-23T09:15:01Z",
  "transcriptText": "Bill: I'll send the specs on Friday...",
  "summary": "Reviewed the API integration; Bill owns the spec delivery.",
  "discussionPoints": ["API integration timeline", "Outstanding spec questions"],
  "decisions": ["Bill sends specs by Friday"],
  "summaryModelId": "amazon.nova-lite-v1:0",
  "summaryPromptVersion": "analysis@v2",
  "version": 7
}
```

**Storage row** (table `notetaker-proj-notedetail`, one row per note):

Same shape as `NoteCardList` minus the action items, plus `Version`. Could share a table with `NoteCardList` since both are keyed by `NoteId`, but keeping them separate keeps each projection's rebuild independent.

**Event handlers:** as for `NoteCardList`, minus the `ActionItem*` handlers.

---

### 4. `NoteActions`

**Consumed by:** Actions panel within `NoteEdit`.
**Source events:** all `ActionItem*` events filtered by parent `NoteId`.

```csharp
public record NoteAction(
    ActionId ActionId,
    string Description,
    bool Completed,
    DateTimeOffset AddedAt,
    DateTimeOffset? CompletedAt);

public record NoteActionsView(
    NoteId NoteId,
    IReadOnlyList<NoteAction> Actions);
```

**Wire JSON:**
```json
{
  "noteId": "7f3a...",
  "actions": [
    { "actionId": "9c1d...", "description": "Fill out the form", "completed": false, "addedAt": "2026-04-23T09:14:48Z", "completedAt": null },
    { "actionId": "a2e4...", "description": "Send agenda",       "completed": true,  "addedAt": "2026-04-22T17:01:11Z", "completedAt": "2026-04-23T08:00:02Z" }
  ]
}
```

**Storage row** (table `notetaker-proj-noteactions`):

| PK (NoteId) | SK (ActionId) | Description       | Completed | AddedAt | CompletedAt |
|-------------|---------------|-------------------|-----------|---------|-------------|

Composite key — `Query(PK = NoteId)` returns all actions for the note in one round-trip.

**Event handlers:**
- `ActionItemAdded` → put row keyed by `(NoteId, ActionId)`
- `ActionItemCompleted` → set `Completed = true`, `CompletedAt`
- `ActionItemReopened` → set `Completed = false`, `CompletedAt = null`
- `ActionItemEdited` → update `Description`
- `ActionItemDeleted` → delete row

---

### 5. `TodoList`

**Consumed by:** Home view's TO DO List section. Cross-note view of open action items.
**Source events:** all `ActionItem*` events plus `NoteRenamed` (to keep denormalised note titles fresh) and `NoteDeleted` (to drop orphans).

```csharp
public record TodoItem(
    ActionId ActionId,
    NoteId NoteId,
    string NoteTitle,
    string Description,
    DateTimeOffset AddedAt);

public record TodoListView(
    IReadOnlyList<TodoItem> Items);   // empty list → UI shows "Your ToDo list is clear."
```

**Wire JSON (empty state):**
```json
{ "items": [] }
```

**Wire JSON (populated):**
```json
{
  "items": [
    { "actionId": "9c1d...", "noteId": "7f3a...", "noteTitle": "Bill 1:1",        "description": "Fill out the form", "addedAt": "2026-04-23T09:14:48Z" },
    { "actionId": "b3f5...", "noteId": "8a2b...", "noteTitle": "API integration", "description": "Reply to Sam",      "addedAt": "2026-04-22T16:42:00Z" }
  ]
}
```

**Storage row** (table `notetaker-proj-todolist`):

| PK (ActionId) | NoteId  | NoteTitle    | Description       | AddedAt |
|---------------|---------|--------------|-------------------|---------|

Only **open** action items are stored — `ActionItemCompleted` removes the row, `ActionItemReopened` reinstates it. Keeps reads cheap (no filter) and the table small.

**Event handlers:**
- `ActionItemAdded` → put row; look up `NoteTitle` from `NoteDetail` projection at handler time
- `ActionItemCompleted` → delete row
- `ActionItemReopened` → put row back (description, addedAt sourced from `NoteActions` projection or by replay)
- `ActionItemEdited` → update `Description` if row exists
- `ActionItemDeleted` → delete row
- `NoteRenamed` → scan for rows with this `NoteId`, update `NoteTitle` (low frequency, scan acceptable; if it grows, add a GSI on `NoteId`)
- `NoteDeleted` → delete all rows with this `NoteId`

> **Cross-projection read on write:** the handler for `ActionItemAdded` reads `NoteTitle` from the `NoteDetail` projection. This is allowed at the *projection layer* (not the aggregate layer). Document it; it's a real coupling and a place rebuilds can race if projections are torn down out of order. A safer alternative is for the handler to project from the event stream directly (find the latest `NoteRenamed` for that `NoteId`); start with the simple version and revisit if rebuild ordering bites.

---

### 6. `TagIndex` *(Phase 4)*

**Consumed by:** tag-based filtering UI; later, the as-you-type tag suggestion input.
**Source events:** `NoteTagged`, `NoteUntagged`, `NoteDeleted`.

```csharp
public record TagIndexEntry(
    string Tag,
    int NoteCount,
    IReadOnlyList<NoteId> NoteIds);

public record TagIndexView(
    IReadOnlyList<TagIndexEntry> Tags);
```

**Wire JSON:**
```json
{
  "tags": [
    { "tag": "1:1s",            "noteCount": 12, "noteIds": ["7f3a...", "..."] },
    { "tag": "API integration", "noteCount": 4,  "noteIds": ["8a2b...", "..."] }
  ]
}
```

**Storage row** (table `notetaker-proj-tagindex`):

| PK (Tag)          | SK (NoteId) | TaggedAt |
|-------------------|-------------|----------|

`Query(PK = Tag)` returns all noteIds with that tag; `Scan` (or a maintained counter row) gives the full tag list for the suggestion input. For Phase 4 scale, scan is fine.

**Event handlers:**
- `NoteTagged` → put row `(Tag, NoteId)`
- `NoteUntagged` → delete row
- `NoteDeleted` → query rows where `NoteId = …`, delete each (needs a GSI on `NoteId`, or a scan)

---

### 7. `TagFeedback` *(Phase 10-J)*

**Consumed by:** ad-hoc analysis of which AI-suggested tags users keep vs reject (no read endpoint — query DynamoDB directly). Feeds future prompt refinement.
**Source events:** `TagsSuggested` / `TagsSuggestedV2`, `NoteUntagged`, `NoteDeleted`. (`NoteTagged` is ignored — acceptance is derived as `Suggested − Rejected`.)

```csharp
public record TagFeedbackView(
    string UserId,
    string Tag,
    int SuggestedCount,
    int RejectedCount);   // AcceptedCount = SuggestedCount - RejectedCount, derived at read time
```

This projection **classifies by combining events** rather than copying state: a tag the AI suggested (`TagsSuggested`) and later removed (`NoteUntagged`) counts as a rejection, but a tag removed with *no prior suggestion* (manual cleanup) does not. The classification needs per-note provenance, so the table holds **two row types**:

**Storage rows** (single table `notetaker-proj-tagfeedback`, keyed `PK` / `SK`):

| Row type   | PK              | SK         | Attributes                      |
|------------|-----------------|------------|---------------------------------|
| Aggregate  | `USER#{userId}` | `TAG#{tag}`| `SuggestedCount`, `RejectedCount` |
| Provenance | `NOTE#{noteId}` | `TAG#{tag}`| `UserId`, `PromptVersion`        |

The aggregate row is the queryable per-(user, tag) counter. The provenance row records that a tag was AI-suggested on a specific note — the state needed to classify a later untag. `PromptVersion` (10-M) records which prompt version produced the suggestion so feedback can be sliced per prompt version; a v1 `TagsSuggested` event (pre-10-M) records `"unknown"`.

**Event handling (live, inline in `NoteCommandHandler`):**
- `TagsSuggested` (v1) / `TagsSuggestedV2` (v2) → per tag: `SuggestedCount++` on the aggregate row; write the provenance row `(noteId, tag, userId, promptVersion)` — `promptVersion` is the event's value for v2, `"unknown"` for v1.
- `NoteUntagged` → if a provenance row `(noteId, tag)` exists: `RejectedCount++` for its `UserId` and **delete** the provenance row (only a fresh `TagsSuggested` re-arms it — prevents a manual re-add/remove from double-counting).
- `NoteDeleted` → delete that note's provenance rows; **counts untouched** (deletion is not tag rejection).

**Accepted approximation (v1):** an accepted tag removed during unrelated cleanup months later still counts as rejected (no time-weighting).

---

### 8. `ActionItemFeedback` *(Phase 10-L)*

**Consumed by:** ad-hoc analysis of AI action-item extraction precision (no read endpoint — query DynamoDB directly). Feeds future prompt refinement.
**Source events:** `ActionItemsSuggested` / `ActionItemsSuggestedV2` (on the `Note` stream), `ActionItemDeleted`, `ActionItemCompleted` (on the `ActionItem` streams).

```csharp
public record ActionItemFeedbackView(
    string UserId,
    int SuggestedCount,
    int DeletedCount,
    int CompletedCount);   // keyed per user only — free-text descriptions don't aggregate per-value, unlike tags
```

Unlike tags (a repeating categorical value), action items are unique free text, so there is nothing to blocklist — the signal is a per-user **quality rate**: of the action items the AI extracted, how many were **deleted** (rejected extraction) vs **completed** (confirmed a real task).

**Storage rows** (single table `notetaker-proj-actionfeedback`, partition key `PK` only — no sort key):

| Row type   | PK                    | Attributes                                  |
|------------|-----------------------|---------------------------------------------|
| Aggregate  | `USER#{userId}`       | `SuggestedCount`, `DeletedCount`, `CompletedCount` |
| Provenance | `ACTION#{actionItemId}` | `UserId`, `PromptVersion`                  |

The provenance row marks an action item as AI-extracted; it is matched by id when the item is later deleted or completed (on its own `ActionItem` stream). `PromptVersion` (10-M) records which prompt version produced the suggestion; a v1 `ActionItemsSuggested` event (pre-10-M) records `"unknown"`.

**Event handling (live, inline across two command handlers):**
- `ActionItemsSuggested` (v1) / `ActionItemsSuggestedV2` (v2, in `NoteCommandHandler`) → per id: `SuggestedCount++` for the current user; write provenance `(actionItemId, userId, promptVersion)` — `promptVersion` is the event's value for v2, `"unknown"` for v1.
- `ActionItemDeleted` (in `ActionItemCommandHandler`) → if provenance for that `ActionId` exists: `DeletedCount++` for its user.
- `ActionItemCompleted` (in `ActionItemCommandHandler`) → if provenance exists: `CompletedCount++`.
- Provenance is **not** consumed — action ids are unique and immutable, so there is no double-count risk.

**Rebuild ordering note:** the suggestion lives on the `Note` stream while the deletion/completion live on `ActionItem` streams, and a rebuild replays streams ordered by id (`action#…` before `note#…`). The rebuild projection therefore defers count computation (records provenance and the deleted/completed id lists, then computes counts in `GetAggregates`) so it is **order-independent**. The live path is naturally ordered (a suggestion always precedes any later delete/complete).

**Accepted approximations (v1):** an item completed *then* deleted increments both counts; reopen and edit are ignored.

---

### 9. `NoteSearchView` *(Phase 22-A)*

**Consumed by:** `GET /notes/search?q=` — fuzzy free-text search across the caller's notes (ranked in-Lambda; see Phase 22). One searchable document per note.
**Source events:** `NoteCreated`, `NoteRenamed`, `ContentEdited` / `ContentEditedV2`, `AnalysisSummaryRecorded`, `NoteTagged`, `NoteUntagged`, `NoteDeleted` (on the `Note` stream); `ActionItem*` (for `ActionItemsText`). **Transcript is deliberately excluded** (long/noisy — would swamp results).

```csharp
public record NoteSearchView(
    NoteId NoteId,
    string UserId,
    string Title,
    string Body,             // Quick notes (ContentEditedV2)
    string FinalNotesText,   // Summary + DiscussionPoints + Decisions, concatenated
    IReadOnlyList<string> Tags,
    string ActionItemsText,  // action-item descriptions, concatenated
    bool Deleted,
    DateTimeOffset LastModifiedAt);
```

**Storage row** (table `notetaker-proj-notesearchview`, partition key `PK` = NoteId):

| PK (NoteId) | UserId (GSI `UserId-index`) | Title | Body | FinalNotesText | Tags (SS) | ActionItemsText | Deleted | LastModifiedAt |
|-------------|-----------------------------|-------|------|----------------|-----------|-----------------|---------|----------------|

The `UserId-index` GSI (ProjectionType.ALL) lets the search endpoint `Query` all of one user's documents; ranking (FuzzySharp, title-weighted, threshold) then runs in-process. A point `GetItem(PK)` (`GetByNoteIdAsync`) serves the write path's read-modify-write so a mutation never scans the GSI.

**Event handlers (live, inline across `NoteCommandHandler` + `ActionItemCommandHandler`):**
- `NoteCreated` / `NoteRenamed` / `ContentEditedV2` / `AnalysisSummaryRecorded` / `NoteTagged` / `NoteUntagged` → upsert the document (title/body/final-notes/tags from `NoteDetail`; `ActionItemsText` preserved from the existing row).
- `ActionItem*` → recompute `ActionItemsText` from the note card's action items.
- `NoteDeleted` → hard-delete the row (prune-on-event).
- **Cross-stream note:** action items live on separate `ActionItem` streams, so the live path derives `ActionItemsText` from the note card; the rebuild path uses the cross-stream `NoteSearchViewProjection` (like `NoteCardList`). Both converge.

**Privacy:** the `SearchPerformed` metric logs only query length + result/scanned counts — never the raw query text or note content.

### 10. `WorkspaceList` *(Phase 23-A)*

**Consumed by:** `GET /workspaces` — the caller's named workspaces for the switcher. One row per created workspace.
**Source events:** `WorkspaceCreated`, `WorkspaceRenamed`, `WorkspaceDeleted` (on the `Workspace` stream).

```csharp
public record WorkspaceListView(
    WorkspaceId WorkspaceId,
    string Name,
    DateTimeOffset CreatedAt,
    string UserId = "");
```

**Storage row** (table `notetaker-proj-workspacelist`, partition key `PK` = WorkspaceId):

| PK (WorkspaceId) | Name | CreatedAt | UserId |
|------------------|------|-----------|--------|

**Default workspace is virtual.** The reserved default (`__default__`, name "Personal") is **never persisted** — `GetWorkspaces` synthesises it per-user at read time when no `__default__` row exists, sorted first. It is non-deletable (`DELETE /workspaces/__default__` → `409`). Persisted workspace ids are globally-unique GUIDs (`N` format), so `PK = WorkspaceId` needs no per-user composite key; `UserId` is filtered in the handler (as `FolderTree` does).

**Event handlers (live, inline in `WorkspaceCommandHandler`):** `WorkspaceCreated` → upsert; `WorkspaceRenamed` → upsert with new name; `WorkspaceDeleted` → delete the row.

### Workspace scoping of note-derived views *(Phase 23-B)*

`NoteCardView`, `NoteDetailView`, `NoteTitleListItem`, `NoteSearchView`, and `TagIndexView` each gain a nullable **`WorkspaceId`** attribute. Each projection folds `NoteAssignedToWorkspace` to set it (for `TagIndex`, tag rows inherit their note's workspace via a `noteId→workspace` map the projection maintains). The list/search read endpoints (`/notes/cards`, `/notes`, `/notes/search`, `/tags`) filter by `(user, workspace)` — a **null** `WorkspaceId` (rows written before 23-B) resolves to the reserved default workspace via `ICurrentWorkspace.Includes`. **No DynamoDB key-schema change:** the attribute is additive, and `NoteSearchView`'s `UserId-index` GSI is `ProjectionType.ALL`, so it auto-projects the new attribute (the workspace filter runs in-Lambda after the per-user query). Point reads/mutations of a single note stay user-scoped by note id; `NoteActions` is scoped transitively via its parent note (never listed cross-note), so its rows carry no `WorkspaceId`.

---

## Soft delete handling

Two valid approaches; pick one and apply consistently:

1. **Filter on read.** Keep a `Deleted` flag on each row; queries `FilterExpression` it out. Simple; rebuild trivially correct. Wastes a tiny bit of storage and read capacity.
2. **Prune on event.** Hard-delete the projection row when `NoteDeleted` fires. Cleaner storage; rebuild must replay `NoteDeleted` to re-prune (it does, automatically).

Recommendation: start with (1) for simplicity, switch to (2) if a projection grows large enough to matter. The event store always has the full history either way.

---

## Rebuild

Every projection implements `Reset()` and a fold over the full event stream (see [`projection`](../dot-claude/skills/projection/SKILL.md) skill). Storage is per-projection so a rebuild touches one table only — zero blast radius.

```csharp
public interface IProjection
{
    Task HandleAsync(EventEnvelope envelope);
    Task ResetAsync();
}
```

A rebuild loop:

```csharp
async Task RebuildAsync(IProjection projection)
{
    await projection.ResetAsync();
    await foreach (var envelope in eventStore.ReadAllAsync())
        await projection.HandleAsync(envelope);
}
```

Run rebuilds out of band (Lambda invoked by an admin endpoint or a one-off CLI). Don't block the live API.

---

## Conventions

- **DTOs are records, not classes.** Cheap value semantics, immutable, easy to serialise.
- **JSON casing is camelCase.** Configure once on the API; don't sprinkle `[JsonPropertyName]` everywhere.
- **Empty list, not null.** `Items = []` for empty states. Never null collections in wire JSON.
- **No domain types in wire JSON.** Strongly-typed `NoteId` / `ActionId` serialise as plain `Guid` strings; the React side has no idea they're strongly typed.
- **One projection, one query endpoint.** If the UI needs a different shape, build a new projection — don't bend an existing one. The cost of an extra projection is low; the cost of a multi-purpose projection is high.
- **`Version` only on `NoteDetail`.** It's the only view used as input to a write. Other projections don't need it.

---

## How to update this document

- Update **at the same time** as adding or modifying a projection.
- Keep the C# DTO and the JSON example in sync.
- A new projection should appear in [`event-model.md`](./event-model.md)'s Projections table first, then get a schema entry here.
