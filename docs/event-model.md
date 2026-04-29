# Event Model

The living event model for the system. Diagrams may live in Excalidraw or Miro — keep snapshots and a link here.

> **Canonical board:** *(add Excalidraw/Miro link)*

The flows below are derived from the initial wireframes and represent the Phase 1–4 scope. Phases 5–7 (Calendar, transcription, auth) extend the model and will be added when those phases start.

---

## Aggregates

Two aggregates are proposed. The split lets `ActionItem` have its own lifecycle (added, completed, reopened) independent of the parent `Note`, which produces the cross-aggregate todo projection — a deliberate event-sourcing learning moment.

### Note

Holds title, captured content, tags, and the open/closed state. Action items are referenced by ID but live on their own aggregate.

| State | Description |
|---|---|
| `Title` | User-entered name for the note |
| `Content` | Current text of the captured-notes area (latest snapshot wins) |
| `Tags` | Set of strings (free text, space-tokenised on input — one tag per token) |
| `Date` | Optional user-specified date for the note (e.g. the meeting date); `null` until set |
| `Status` | `Active` / `Deleted` (soft delete) |

### ActionItem

A discrete to-do extracted within a note. Owns its own completion lifecycle.

| State | Description |
|---|---|
| `NoteId` | Parent note (for projection joins; aggregates do not reach across) |
| `Description` | Free text |
| `Status` | `Open` / `Completed` |

---

## Commands → Events

### Note

| Command | Pre-conditions | Events emitted |
|---|---|---|
| `CreateNote(noteId, createdAt)` | NoteId does not exist | `NoteCreated` (with empty title) |
| `RenameNote(noteId, newTitle, renamedAt)` | Note exists, not deleted, new title differs from current | `NoteRenamed` |
| `EditContent(noteId, content, editedAt)` | Note exists, not deleted, content differs from current | `ContentEdited` |
| `TagNote(noteId, tag, taggedAt)` | Note exists, tag not already present (one command per token) | `NoteTagged` |
| `UntagNote(noteId, tag, untaggedAt)` | Note exists, tag present | `NoteUntagged` |
| `SetNoteDate(noteId, date, setAt)` | Note exists, not deleted | `NoteDateSet` |
| `DeleteNote(noteId, deletedAt)` | Note exists, status ≠ Deleted | `NoteDeleted` |

### ActionItem

| Command | Pre-conditions | Events emitted |
|---|---|---|
| `AddActionItem(actionId, noteId, description, addedAt)` | ActionId does not exist; parent note exists and is not deleted | `ActionItemAdded` |
| `CompleteActionItem(actionId, completedAt)` | ActionItem exists, status = Open | `ActionItemCompleted` |
| `ReopenActionItem(actionId, reopenedAt)` | ActionItem exists, status = Completed | `ActionItemReopened` |
| `EditActionItem(actionId, newDescription, editedAt)` | ActionItem exists, not deleted | `ActionItemEdited` |
| `RemoveActionItem(actionId, removedAt)` | ActionItem exists | `ActionItemRemoved` |

---

## Events

> **Wire shape:** the C# records, JSON payloads, envelope, and DynamoDB row layout all live in [`event-schemas.md`](./event-schemas.md). The summary below names the events and their key fields.

### Note

- `NoteCreated { NoteId }` — title starts empty; the first `NoteRenamed` lands when the user blurs the title field
- `NoteRenamed { NoteId, NewTitle }`
- `ContentEdited { NoteId, Content }` — full snapshot of the captured-notes area at save time
- `NoteTagged { NoteId, Tag }`
- `NoteUntagged { NoteId, Tag }`
- `NoteDateSet { NoteId, Date }` — user-specified `DateOnly`; can be set or changed at any time while the note is active
- `NoteDeleted { NoteId }` — soft delete; event remains in the stream, projections filter it out

### ActionItem

- `ActionItemAdded { ActionId, NoteId, AddedAt, Description }`
- `ActionItemCompleted { ActionId, CompletedAt }`
- `ActionItemReopened { ActionId, ReopenedAt }`
- `ActionItemEdited { ActionId, EditedAt, NewDescription }`
- `ActionItemRemoved { ActionId, RemovedAt }`

---

## Views

The wireframes show three primary views:

- **Home** — entry point. Composes `TodoList` (open action items across all notes) and `NoteCardList` (saved notes as rich cards). Sidebar shows simple list of note titles.
- **NoteEdit** — open a note to capture content, tags, action items. There is no read-only mode — every note is always editable. Persistence is auto-save: each editable field emits a command on debounce (~500ms after typing stops) or blur. "Close" is UI navigation back to Home, not a domain state change.

## Projections

The Home view's richness pushes us toward denormalized read models — `NoteCardList` carries everything the card needs, no client-side join.

> **Wire shape:** the C# DTOs, JSON payloads, DynamoDB row layout, and event handlers for each projection live in [`view-schemas.md`](./view-schemas.md). The table below names the projections and their inputs.

| Projection | Source events | Used by |
|---|---|---|
| `NoteTitleList` | `NoteCreated`, `NoteRenamed`, `NoteDeleted` | Sidebar list of note titles |
| `NoteCardList` | All Note events + `ActionItemAdded`, `ActionItemCompleted`, `ActionItemRemoved` | Home view's Notes section — denormalized cards with title, date, content preview, tags, action items. Filters out soft-deleted notes. |
| `NoteDetail` | All Note events for a given NoteId | NoteEdit view |
| `NoteActions` | All ActionItem events filtered by NoteId | Actions panel within a note |
| `TodoList` | All ActionItem events across all notes (open only) | Home view's TO DO List section. Empty state: "Your ToDo list is clear." |
| `TagIndex` | `NoteTagged`, `NoteUntagged`, `NoteDeleted` | Tag-based filtering (Phase 4) |

**Implication for milestones:** the `TodoList` projection is now visible in the Home view from day one (empty state initially), so the projection scaffold lands in Phase 1 even though the action-item events that populate it land in Phase 3. Easier to scaffold an empty projection early than to retrofit the Home view later.

---

## Flows derived from wireframes

### Flow A — Create a note

```
View: Home (sidebar + cards)
  ↓ user clicks "Create Note"
Command: CreateNote(noteId, createdAt)
  ↓
Event: NoteCreated  (title empty)
  ↓ projections updated: NoteTitleList, NoteCardList, NoteDetail
View: NoteEdit (blank title, blank captured-notes area, empty tags, empty actions)
```

### Flow B — Set / change the title

```
View: NoteEdit
  ↓ user types in Note Name field, then blurs (tabs/clicks away) or pauses ~500ms
Command: RenameNote(noteId, newTitle, renamedAt)
  ↓ no-op if newTitle == current title
Event: NoteRenamed
  ↓ projections updated: NoteTitleList, NoteCardList, NoteDetail
```

### Flow C — Capture content (auto-save)

```
View: NoteEdit
  ↓ user types in Captured Notes area; on debounce (~500ms idle) or blur
Command: EditContent(noteId, content, editedAt)
  ↓ no-op if content == current content
Event: ContentEdited  (full snapshot of the area)
  ↓ projections updated: NoteDetail, NoteCardList
```

### Flow D — Tag a note

```
View: NoteEdit
  ↓ user types tag input "1:1s Bill API" and presses enter
Input parser: tokenise on whitespace → ["1:1s", "Bill", "API"]
  ↓ for each new token (skip ones already on the note)
Command: TagNote(noteId, tag, taggedAt)
  ↓
Event: NoteTagged  (one event per tag)
  ↓ projections updated: NoteDetail, NoteCardList, TagIndex
View: NoteEdit (tags appear as pills)
```

*Future (post-MVP): a Phase 4+ enhancement will surface suggested tags as the user types, drawn from the `TagIndex` projection. The event model is unchanged — suggestions just feed the input UI; the resulting commands and events are the same `TagNote` / `NoteTagged`.*

### Flow E — Add an action item

```
View: NoteEdit
  ↓ user adds "Fill out form" to Actions
Command: AddActionItem(actionId, noteId, description, addedAt)
  ↓
Event: ActionItemAdded
  ↓ projections updated: NoteActions, TodoList, NoteCardList
View: NoteEdit (action appears as bullet)
```

### Flow F — Complete an action item *(not in wireframes; implied for Phase 3)*

```
View: Home TodoList (cross-note) or NoteEdit
  ↓ user ticks an action complete
Command: CompleteActionItem(actionId, completedAt)
  ↓
Event: ActionItemCompleted
  ↓ projections updated: NoteActions, TodoList, NoteCardList
View: TodoList (item moves to completed section / disappears from open list)
```

### Flow H — Set or change the note date

```
View: NoteEdit
  ↓ user picks a date from the date picker (or clears it — handled client-side, no event for null)
Command: SetNoteDate(noteId, date, setAt)
  ↓
Event: NoteDateSet  (DateOnly — the user-chosen date, not the event timestamp)
  ↓ projections updated: NoteDetail, NoteCardList
View: NoteEdit (date field reflects the chosen date)
```

*The date picker emits `SetNoteDate` on every change (no debounce needed — picking a date is a single discrete action, not continuous typing).*

### Flow G — Delete a note (soft delete)

```
View: NoteEdit (or NoteCardList card menu)
  ↓ user chooses "Delete Note"
Command: DeleteNote(noteId, deletedAt)
  ↓
Event: NoteDeleted  (event remains in stream)
  ↓ projections updated: NoteTitleList, NoteCardList, TagIndex (all filter out deleted)
View: Home (note no longer visible in sidebar or cards)
```

*Note: "Close Note" in the wireframes is UI-only — it navigates back to Home without emitting any event. Auto-save means everything is already persisted by the time the user leaves the view.*

---

## Resolved decisions

- **Auto-save, no "Closed" state.** Every field saves on debounce/blur. "Close Note" is UI navigation back to Home — not a domain event. Notes have only `Active` / `Deleted` status.
- **`ContentEdited` snapshots, not appends.** Auto-save makes append-fragments noisy and fragile (deletions break naive concatenation). Each `ContentEdited` carries the full snapshot of the captured-notes area at save time. History = sequence of snapshots.
- **Title set after creation.** `CreateNote` carries no title; the title field lives inside `NoteEdit` and emits `NoteRenamed` on first blur. Two events for the first naming, but matches the wireframes and means "create" is unconditional.
- **Tags are free text, space-tokenised.** The tag input accepts a string; the input parser splits on whitespace and emits one `TagNote` command per token. No curated tag aggregate. (Phase 4+: suggest tags as the user types, sourced from `TagIndex`. Pure UI enhancement — events unchanged.)
- **Soft delete.** `NoteDeleted` stays in the stream; projections filter deleted notes out of read models.

## Open design questions

*(none currently — all resolved above. Add new ones here as they arise during implementation.)*

## How to update this document

- Update **before** writing a new BDD spec.
- Diagram first, table second. The diagram is the artefact; the table is for skim-reading.
- Update the canonical board link after any restructure.
