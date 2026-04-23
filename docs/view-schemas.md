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
**Source events:** all `Note*` events plus `ActionItemAdded`, `ActionItemCompleted`, `ActionItemReopened`, `ActionItemEdited`, `ActionItemRemoved`.

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
- `NoteDeleted` → set `Deleted = true` (filter in queries)
- `ActionItemAdded` → append to `ActionItems`, `LastModifiedAt`
- `ActionItemCompleted` → mark item `completed = true`
- `ActionItemReopened` → mark item `completed = false`
- `ActionItemEdited` → update item description
- `ActionItemRemoved` → remove from `ActionItems`

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
    DateTimeOffset CreatedAt,
    DateTimeOffset LastModifiedAt,
    long Version);                  // current stream sequence number
```

`Version` is returned so the client can include it on the next command for optimistic concurrency (see [`dynamodb-event-append`](../dot-claude/skills/dynamodb-event-append/SKILL.md)).

**Wire JSON:**
```json
{
  "noteId": "7f3a...",
  "title": "Bill 1:1",
  "content": "Met with Bill re: API integration. He'll send specs Friday.",
  "tags": ["1:1s", "Bill"],
  "createdAt": "2026-04-23T09:14:22Z",
  "lastModifiedAt": "2026-04-23T09:15:01Z",
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
- `ActionItemRemoved` → delete row

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
- `ActionItemRemoved` → delete row
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
