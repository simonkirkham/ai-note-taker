# Event Model

The living event model for the system. Diagrams may live in Excalidraw or Miro — keep snapshots and a link here.

> **Canonical board:** *(add Excalidraw/Miro link)*

The flows below are derived from the initial wireframes and represent the Phase 1–4 scope. Phases 5–7 (Calendar, transcription, auth) extend the model and will be added when those phases start.

---

## Aggregates

Three aggregates exist. `ActionItem` and `Todo` both feed the unified `TodoList` projection via a `type` discriminator — a deliberate event-sourcing learning moment showing how heterogeneous streams merge into a single read model.

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

### Todo

A standalone to-do not attached to any note. Created from the home screen quick-add input.

| State | Description |
|---|---|
| `Description` | Free text |
| `Priority` | Optional — `null` until priority UI lands; future values: `Today` / `Next` / `Later` |
| `Status` | `Open` / `Completed` / `Deleted` |

### Workspace *(Phase 23)*

A named partition of a user's content (e.g. *Work* / *Personal*). A second isolation dimension layered over the Phase 8 `UserId` scope. A note's workspace membership is **domain state on the `Note` aggregate** (`NoteAssignedToWorkspace`, latest-wins), not on this aggregate — modelled on `NoteFiledInFolder`.

| State | Description |
|---|---|
| `WorkspaceId` | Identity — a globally-unique GUID (`N` format), or the reserved sentinel `__default__` |
| `Name` | User-entered name (default workspace is "Personal") |
| `Status` | `Active` / `Deleted` |

> The reserved default workspace (`__default__`) is **virtual** — synthesised at read time per user, never persisted, never deletable. All historical (unassigned) content resolves to it. No event-log migration.

---

## Commands → Events

### Note

| Command | Pre-conditions | Events emitted |
|---|---|---|
| `CreateNote(noteId, workspaceId)` | NoteId does not exist | `NoteCreated` (empty title) + `NoteAssignedToWorkspace` (the request's workspace, 23-B) |
| `RenameNote(noteId, newTitle, renamedAt)` | Note exists, not deleted, new title differs from current | `NoteRenamed` |
| `EditContent(noteId, content, editedAt)` | Note exists, not deleted, content differs from current | `ContentEdited` |
| `TagNote(noteId, tag, taggedAt)` | Note exists, tag not already present (one command per token) | `NoteTagged` |
| `UntagNote(noteId, tag, untaggedAt)` | Note exists, tag present | `NoteUntagged` |
| `SetNoteDate(noteId, date, setAt)` | Note exists, not deleted | `NoteDateSet` |
| `RecordTagSuggestions(noteId, tags, modelId, promptVersion)` | Note exists, not deleted; empty tag list emits nothing | `TagsSuggestedV2` |
| `RecordActionItemSuggestions(noteId, actionItemIds, modelId, promptVersion)` | Note exists, not deleted; empty list emits nothing | `ActionItemsSuggestedV2` |
| `RecordAnalysisSummary(noteId, summary, discussionPoints, decisions, modelId, promptVersion)` | Note exists, not deleted | `AnalysisSummaryRecorded` |
| `RecordInstructionResponses(noteId, responses[], modelId, promptVersion)` | Note exists, not deleted; full snapshot (empty list clears prior responses) | `InstructionResponsesRecorded` |
| `CompleteTranscription(noteId, transcriptText, durationSeconds)` | Note exists, not deleted; blank text rejected at the API | `TranscriptionCompleted` |
| `SaveRecording(noteId, audioKey)` | Note exists, not deleted; blank key rejected (API 400 + aggregate guard) | `RecordingUploaded` |
| `RecordDiarizedTranscription(noteId, text, speakerCount, jobId, sourceAudioKey)` | Note exists, not deleted; blank text rejected (aggregate guard) | `TranscriptionDiarized` |
| `DeleteNote(noteId, deletedAt)` | Note exists, status ≠ Deleted | `NoteDeleted` |

> `RecordTagSuggestions` / `RecordActionItemSuggestions` are issued by the analysis handler (not the user) to record which tags / action items an AI run contributed. They record provenance only — tags are applied separately via `TagNote`/`NoteTagged`, and action items via `AddActionItem`/`ActionItemAdded` on the `ActionItem` aggregate (the suggestion event references them by id).
>
> `RecordAnalysisSummary` is also issued by the analysis handler. It records the AI's structured **Final notes** artifact (Summary, Discussion points, Decisions) as a separate first-class fact — a full snapshot where the latest wins, like `ContentEdited`. From Phase 15-A onward analysis **never** edits the user's notes (`ContentEdited` is no longer emitted by the analysis path); the AI's output lives only in `AnalysisSummaryRecorded`, attributed by `ModelId`/`PromptVersion`. Action items are **not** duplicated into this event — they remain `ActionItem` aggregates (single source of truth), referenced for provenance via `ActionItemsSuggested`.
>
> `RecordInstructionResponses` is issued by the analysis handler when the user's Quick notes contained one or more inline `/ai` instructions (Phase 29) **or** when a previous run recorded responses that must now be cleared. The handler extracts the `/ai` lines from the note *before* analysis (so they never reach the grounded summary), passes them to the model, and records the model's per-instruction `{instruction, response}` pairs as `InstructionResponsesRecorded` — a full snapshot, latest wins, attributed by `ModelId`/`PromptVersion`. The aggregate always emits when the command is handled (an empty list is a valid "cleared" snapshot); the handler simply never issues the command for a note that has neither current nor prior responses, so a note that never had a `/ai` line produces no event and behaves exactly as before.

### ActionItem

| Command | Pre-conditions | Events emitted |
|---|---|---|
| `AddActionItem(actionId, noteId, description, addedAt)` | ActionId does not exist; parent note exists and is not deleted | `ActionItemAdded` |
| `CompleteActionItem(actionId, completedAt)` | ActionItem exists, status = Open | `ActionItemCompleted` |
| `ReopenActionItem(actionId, reopenedAt)` | ActionItem exists, status = Completed | `ActionItemReopened` |
| `EditActionItem(actionId, newDescription, editedAt)` | ActionItem exists, not deleted | `ActionItemEdited` |
| `DeleteActionItem(actionId, deletedAt)` | ActionItem exists | `ActionItemDeleted` |

### Todo

| Command | Pre-conditions | Events emitted |
|---|---|---|
| `AddTodo(todoId, description, priority?, addedAt)` | TodoId does not exist | `TodoAdded` |
| `CompleteTodo(todoId, completedAt)` | Todo exists, status = Open | `TodoCompleted` |
| `ReopenTodo(todoId, reopenedAt)` | Todo exists, status = Completed | `TodoReopened` |
| `DeleteTodo(todoId, deletedAt)` | Todo exists, not already deleted | `TodoDeleted` |

### TodoOrdering *(Phase 37)*

| Command | Pre-conditions | Events emitted |
|---|---|---|
| `ReorderTodos(workspaceId, orderedItemIds, reorderedAt)` | `orderedItemIds` non-empty | `TodoListReordered` |

> **Per-workspace ordering of the home To Do list.** The list interleaves standalone todos and note-derived action items, so ordering is a *list-level* concern keyed by workspace (stream `todo-order#<workspaceId>`) rather than a position on either item aggregate. Each `TodoListReordered` is a full-order snapshot (last-write-wins, no state). The `TodoList` projection folds it into a nullable `Position` per item id; reads sort `Position ?? max`, then `AddedAt`. Records ordering only — no ownership check against the async projection; stale ids in a snapshot are ignored.

### Workspace *(Phase 23-A)*

| Command | Pre-conditions | Events emitted |
|---|---|---|
| `CreateWorkspace(workspaceId, name)` | WorkspaceId does not exist; name non-empty | `WorkspaceCreated` |
| `RenameWorkspace(workspaceId, newName)` | Workspace exists, not deleted; new name non-empty and differs | `WorkspaceRenamed` |
| `DeleteWorkspace(workspaceId)` | Not the default (`__default__`); workspace exists, not deleted | `WorkspaceDeleted` |
| `ConnectWorkspaceCalendar(workspaceId, provider, accountRef)` *(34-B)* | Workspace exists, not deleted; provider non-empty; no-op if same provider+account | `WorkspaceCalendarConnected` |
| `DisconnectWorkspaceCalendar(workspaceId)` *(34-B)* | Workspace exists, not deleted; no-op if not connected | `WorkspaceCalendarDisconnected` |
| `SetWorkspaceTheme(workspaceId, theme)` *(36-A)* | Workspace exists, not deleted; theme non-empty; no-op if unchanged | `WorkspaceThemeSet` |

> **Calendar connect/disconnect (34-B) is recorded for NON-default workspaces only.** The reserved default workspace (`__default__`) has no per-user aggregate stream (it is synthesised, never stored, and its stream id is shared across users), so the connect endpoint skips the event for it. The authoritative per-(user, workspace) calendar credential lives in the `CalendarTokenStore` either way; the event records the provider choice for per-workspace provider resolution (34-C) plus an audit trail. Recording is best-effort — the token (written first) is the source of truth for reads.

> Deleting `__default__` is rejected in the aggregate (`DefaultWorkspaceUndeletableException` → `409`). The **block-if-non-empty** pre-condition (23-C) is enforced in `WorkspaceCommandHandler` (the aggregate can't query notes): it checks the caller's active (non-deleted) note count in the target workspace via `INoteCardListStore` and throws `WorkspaceNotEmptyException` → `409`.
>
> **Folders and standalone to-dos carry workspace via `EventMetadata.WorkspaceId`** (23-C, decision #3 — they are not movable, so per-event metadata suffices and avoids versioning `FolderCreated`/`TodoAdded`). `EventEnvelopeFactory.CreateEnvelopes` stamps the request workspace; `FolderTree` and `TodoList` read it from the envelope. Action-item to-do rows instead inherit their **parent note's** workspace (via the note's `NoteAssignedToWorkspace`, tracked in a `noteId→workspace` map in `TodoListProjection`).

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
- `TagsSuggested { NoteId, Tags[] }` (v1) / `TagsSuggestedV2 { NoteId, Tags[], ModelId, PromptVersion }` (v2, 10-M) — AI provenance; records the tags an analysis run contributed (the post-dedup applied set), so a later `NoteUntagged` of one can be classified as a rejected AI suggestion. v2 stamps `ModelId`/`PromptVersion` so the correction ties to the exact prompt/model. The aggregate emits **v2**; v1 remains for streams written before 10-M. No aggregate state change
- `ActionItemsSuggested { NoteId, ActionItemIds[] }` (v1) / `ActionItemsSuggestedV2 { NoteId, ActionItemIds[], ModelId, PromptVersion }` (v2, 10-M) — AI provenance; records (by id) the action items an analysis run created, so a later `ActionItemDeleted`/`ActionItemCompleted` can be attributed to the AI. v2 stamps `ModelId`/`PromptVersion`. The aggregate emits **v2**; v1 remains for pre-10-M streams. No aggregate state change
- `AnalysisSummaryRecorded { NoteId, Summary, DiscussionPoints[], Decisions[], ModelId, PromptVersion }` — the AI's Final notes artifact; full snapshot, latest wins (like `ContentEdited`). `ModelId`/`PromptVersion` attribute who/what generated it. Folds into `NoteDetail.summary`/`discussionPoints`/`decisions`/`summaryModelId`/`summaryPromptVersion`
- `InstructionResponsesRecorded { NoteId, Responses: [{ Instruction, Response }], ModelId, PromptVersion }` — the AI's responses to inline `/ai` instructions (Phase 29); full snapshot, latest wins. Folds into `NoteDetail.instructionResponses`. Only emitted when the note had at least one `/ai` instruction.
- `TranscriptionCompleted { NoteId, TranscriptText, DurationSeconds }` — the finalised transcript of a recording; full snapshot, latest wins (a re-record replaces). Folds into `NoteDetail.transcriptText`. One per completed recording. A **resumed** recording (Phase 18-C "continue") seeds the new session from the prior committed transcript and commits the **concatenation** (prior + `— resumed —` + new turns) — still one `TranscriptionCompleted` per commit; resume is a frontend concatenation, not a new event.
- `RecordingUploaded { NoteId, AudioKey }` (Phase 33-A) — the S3 key of the captured call recording (a WAV teed from the live 16 kHz mono PCM and uploaded on Stop). Full snapshot, latest wins (a re-record overwrites). Folds into `NoteDetail.recordingAudioKey`, which drives the "Download recording" link (URL fetched lazily via presign-download). Independent of `TranscriptionCompleted` — the transcript and the audio are separate facts; the audio is a working artefact (the recordings bucket expires objects after 7 days) and the input 33-B's batch diarization consumes.
- `TranscriptionDiarized { NoteId, Text, SpeakerCount, JobId, SourceAudioKey }` (Phase 33-B1) — the speaker-labelled transcript produced by an Amazon Transcribe **batch** job (`ShowSpeakerLabels`) over the saved recording, appended **asynchronously** by the dedicated `TranscribeCompletion` Lambda (EventBridge "Transcribe Job State Change" → fetch result → parse `Speaker N:` turns). Full snapshot, **latest wins over `TranscriptionCompleted`** (it replaces the streamed transcript). Folds into `NoteDetail.transcriptText` **and** sets `NoteDetail.transcriptIsDiarized = true` (the flag the frontend polls to clear the "Refining…" chip). On a FAILED/empty/poison job no event is appended — the streamed transcript stays. Re-analysis on the diarized text is **33-B2**, not this event.
- `NoteDeleted { NoteId }` — soft delete; event remains in the stream, projections filter it out
- `NoteAssignedToWorkspace { NoteId, WorkspaceId }` *(Phase 23-B)* — latest-wins workspace membership, folded on the Note aggregate like `NoteFiledInFolder`. Emitted by `CreateNote` (and by `MoveNoteToWorkspace` in 23-F). Note-derived read models (NoteCard/NoteDetail/NoteTitleList/NoteSearchView/TagIndex) fold it to carry `WorkspaceId`; a note with no such event resolves to the default workspace at read time

> **Transcription checkpoints are NOT events.** While a recording is in progress the browser autosaves the partial transcript every few seconds to an overwrite-in-place **draft store** (`ITranscriptionDraftStore`, a loss-tolerant recovery buffer keyed by note, self-reaped via TTL), **not** the event log — see [ADR 0011](adr/0011-transcription-checkpoints-draft-store.md). Only the final, committed transcript becomes a `TranscriptionCompleted` event; a clean stop also deletes the draft. The draft is composed into `GET /notes/{id}` at read time (`transcriptDraft`) purely so an interrupted recording can be recovered; it is never a projection field and holds no authoritative state.

### ActionItem

- `ActionItemAdded { ActionId, NoteId, AddedAt, Description }`
- `ActionItemCompleted { ActionId, CompletedAt }`
- `ActionItemReopened { ActionId, ReopenedAt }`
- `ActionItemEdited { ActionId, EditedAt, NewDescription }`
- `ActionItemDeleted { ActionId, DeletedAt }`

### Todo

- `TodoAdded { TodoId, UserId, Description, Priority? }` — `Priority` nullable; reserved for future prioritisation UI
- `TodoCompleted { TodoId, CompletedAt }`
- `TodoReopened { TodoId, ReopenedAt }`
- `TodoDeleted { TodoId, DeletedAt }`
- `TodoListReordered { WorkspaceId, OrderedItemIds, ReorderedAt }` *(Phase 37)* — full-order snapshot of the home To Do open-items list for one workspace; on the `todo-order#<workspaceId>` stream

### Workspace *(Phase 23-A)*

- `WorkspaceCreated { WorkspaceId, Name }`
- `WorkspaceRenamed { WorkspaceId, NewName }`
- `WorkspaceDeleted { WorkspaceId }` — hard-removes the `WorkspaceList` row; the stream retains the event
- `WorkspaceCalendarConnected { WorkspaceId, Provider, AccountRef }` *(34-B)* — a calendar account is connected to the workspace; `AccountRef` is the account email (nullable). Folded by the aggregate (enforces connect/disconnect invariants); no read projection folds it (connection status is read from the strongly-consistent `CalendarTokenStore`). Never recorded for `__default__`.
- `WorkspaceCalendarDisconnected { WorkspaceId }` *(34-B)* — clears the workspace's calendar connection.
- `WorkspaceThemeSet { WorkspaceId, Theme }` *(36-A)* — the per-workspace UI theme; latest-wins. Folded by the aggregate and by `WorkspaceList` (carries `Theme` to `GET /workspaces`). Never recorded for `__default__`.

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
| `NoteCardList` | All Note events + `ActionItemAdded`, `ActionItemCompleted`, `ActionItemReopened`, `ActionItemDeleted` | Home view's Notes section — denormalized cards with title, date, content preview, tags, action items. Filters out soft-deleted notes. |
| `NoteDetail` | All Note events for a given NoteId | NoteEdit view |
| `NoteActions` | All ActionItem events filtered by NoteId | Actions panel within a note |
| `TodoList` | All ActionItem events (all notes) + all Todo events + `TodoListReordered` | Home view's TO DO List section. Returns open items plus items completed today. Each row carries a `type` discriminator (`"action"` / `"todo"`), a plain-string `ItemId`, nullable `NoteId`/`NoteTitle`, nullable `CompletedAt`, and a nullable `Position` (37 — explicit drag order; rows sort `Position ?? max`, then `AddedAt`). Empty state: "Your ToDo list is clear." |
| `TagIndex` | `NoteTagged`, `NoteUntagged`, `NoteDeleted` | Tag-based filtering (Phase 4) |
| `NoteSearchView` | All Note events (title/content/summary/tags) + `ActionItem*`; **transcript excluded** | Fuzzy free-text search (`GET /notes/search?q=`); `UserId-index` GSI, ranked in-Lambda (Phase 22-A) |
| `WorkspaceList` | `WorkspaceCreated`, `WorkspaceRenamed`, `WorkspaceThemeSet`, `WorkspaceDeleted` | The workspace switcher (`GET /workspaces`); carries each workspace's `Theme` (36-A); default `__default__` synthesised at read time (Phase 23-A) |

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
  ↓ user picks a date from the date picker
Command: SetNoteDate(noteId, date, setAt)  — date is DateOnly? (null = cleared)
  ↓
Event: NoteDateSet  (DateOnly? — the user-chosen date; null when the user clears the field)
  ↓ projections updated: NoteDetail, NoteCardList
View: NoteEdit (date field reflects the chosen date, or is empty if null)
```

*The date picker emits `SetNoteDate` on every change (no debounce needed — picking a date is a single discrete action, not continuous typing). Clearing emits `SetNoteDate(noteId, null, setAt)`.*

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
