# Phase 2 — Richer Note Lifecycle

**Goal:** you've changed your mind about an event's shape at least once and survived. By the end of this phase a user can write content into a note, delete notes they no longer need, and the projection can be rebuilt from scratch — covering event versioning, soft delete, and projection rebuild as deliberate learning targets.

**Scope note:** The roadmap lists `NoteDeleted`, `NoteContentReplaced`, and event versioning as Phase 2 work. `NoteContentReplaced` was resolved to `ContentEdited` (full snapshot) in the event model. Phase 2 delivers five slices: NoteDetail projection, EditContent, event versioning, DeleteNote, and projection rebuild. Every slice is full-stack: backend criteria are not sufficient — the user must be able to experience the value in the browser.

Status key: `Done` · `In Progress` · `Not Started`

---

## Slice 2-A — Load and display note content
**Status:** In Progress

**Value:** Users can open a note and see its content — the app graduates from "a list of titles" to "something you can actually read."

**Commands in scope:** none (read-side only)
**Events subscribed:** `NoteCreated`, `NoteRenamed`, `ContentEdited`

**Acceptance criteria:**

*Backend (done):*
- [x] `NoteDetailView` record defined: `NoteId`, `Title`, `Content`, `CreatedAt`, `LastModifiedAt`
- [x] `INoteDetailStore` interface with `UpsertAsync` and `GetAsync`
- [x] `NoteDetailProjection` in-memory fold handles `NoteCreated`, `NoteRenamed`, `ContentEdited`
- [x] `DynamoDbNoteDetailStore` persists and retrieves `NoteDetailView` rows
- [x] `NoteCommandHandler` updates `NoteDetailProjection` on every command
- [x] `GET /notes/{id}` returns `200` with `{ noteId, title, content, createdAt, lastModifiedAt }`
- [x] `GET /notes/{id}` returns `404` for a non-existent `noteId`
- [x] BDD projection specs, API integration tests, acceptance tests all green
- [x] CDK stack updated: `notetaker-proj-notedetail` table, IAM grants, env var

*Frontend (not started):*
- [ ] `api.ts` — `getNoteDetail(noteId)` calls `GET /notes/{id}` and returns `{ noteId, title, content }`
- [ ] `NoteView` fetches the note detail on mount and shows a loading state while the request is in flight
- [ ] `NoteView` renders the `content` field in a read-only area (textarea or `<p>`) below the title input
- [ ] If the fetch fails or returns `404`, `NoteView` shows an error message and a back button
- [ ] E2E journey: create a note, add content via `PUT` (direct API call in test setup), open the note in the UI — content is visible without a page refresh

---

## Slice 2-B — Write and save note content
**Status:** In Progress

**Value:** Users can type meeting notes and have them saved automatically — the core use case of the app.

**Commands in scope:** `EditContent`
**Events in scope:** `ContentEdited`

**Acceptance criteria:**

*Backend (done):*
- [x] `ContentEdited(NoteId, NewContent)` event record; `EventDeserializer` handles it
- [x] `EditContent(NoteId, Content)` command record
- [x] `Note` aggregate: guards existence, no-op if content unchanged, emits `ContentEdited`
- [x] `Note` aggregate `Apply` tracks `_content`
- [x] `NoteDetailProjection` handles `ContentEdited`: updates `Content` and `LastModifiedAt`
- [x] BDD domain specs (happy path, guard, no-op), BDD projection spec, API integration tests, acceptance tests all green
- [x] `PUT /notes/{id}/content` returns `204`; `404` for non-existent note; content + `lastModifiedAt` round-trip verified

*Frontend (not started):*
- [ ] `api.ts` — `editContent(noteId, content)` calls `PUT /notes/{id}/content`
- [ ] `NoteView` replaces the read-only content area with a `<textarea>` pre-populated from the note detail fetch (2-A)
- [ ] On blur, `NoteView` calls `editContent` if the content has changed (no-op on unchanged content matches aggregate behaviour)
- [ ] Optimistic update: textarea value is not reset while the request is in flight
- [ ] On `PUT` failure, the textarea reverts to the last saved value and an error is surfaced
- [ ] E2E journey: open a note, type content into the textarea, blur, navigate back to the list, re-open the note — the typed content is visible

---

## Slice 2-C — Event versioning
**Status:** Not Started

**Value:** The project survives its first event shape change without losing history — the defining "trust the event log" moment of event sourcing.

**Design:** `ContentEdited` v2 adds `CharacterCount: int` (auto-computed from `Content.Length`). Existing v1 events remain readable. `EventDeserializer` routes by `EventVersion`. `NoteDetailProjection` handles both versions gracefully.

**Events in scope:** `ContentEdited` v2 (new shape); v1 remains readable

**Acceptance criteria:**

*Backend:*
- [ ] `ContentEdited` v2 C# record adds `CharacterCount: int`; v1 record preserved as a versioned type
- [ ] `EventDeserializer` routes `ContentEdited` by `EventVersion`: v1 → v1 record, v2 → v2 record
- [ ] New `EditContent` commands write `ContentEdited` with `EventVersion = 2` and `CharacterCount` computed from content length
- [ ] `NoteDetailProjection` handles both v1 and v2 without throwing; content updated correctly in both cases
- [ ] BDD spec — replay v1: projection updates `Content`, no exception
- [ ] BDD spec — replay v2: projection updates `Content`, `CharacterCount` is correct
- [ ] BDD spec — mixed v1 + v2 stream: projection folds correctly in sequence order
- [ ] `EventStoreIntegration` spec: a v1 event written directly to DynamoDB is deserialized without error

*Frontend:*
- [ ] No visible change to the user — `CharacterCount` is an internal metric not exposed in the UI
- [ ] Verify: existing notes with v1 events still load and display content correctly after the deploy

*Note: this is primarily a backend learning slice. The "full-stack" acceptance is confirming the UI is unbroken.*

---

## Slice 2-D — Delete a note
**Status:** Not Started

**Value:** Users can remove notes they no longer need — keeps the list clean and teaches soft delete in an event-sourced system.

**Design:** prune-on-event — `NoteTitleListProjection` and `NoteDetailProjection` hard-delete their DynamoDB rows when `NoteDeleted` fires. The event stream retains the full history.

**Commands in scope:** `DeleteNote`
**Events in scope:** `NoteDeleted`

**Acceptance criteria:**

*Backend:*
- [ ] `NoteDeleted(NoteId)` event record; `EventDeserializer` handles it
- [ ] `DeleteNote(NoteId)` command record
- [ ] `Note` aggregate: guards note exists and is not already deleted, emits `NoteDeleted`; `Apply` sets `_deleted`
- [ ] `RenameNote` and `EditContent` throw `InvalidOperationException` on a deleted note
- [ ] `NoteTitleListProjection` handles `NoteDeleted`: hard-deletes the row
- [ ] `NoteDetailProjection` handles `NoteDeleted`: hard-deletes the row
- [ ] BDD spec — happy path: `Given(NoteCreated)` `.When(DeleteNote)` `.Then(NoteDeleted)`
- [ ] BDD spec — guard: note does not exist → throws
- [ ] BDD spec — double-delete guard: already deleted → throws
- [ ] BDD spec — `RenameNote` rejects a deleted note
- [ ] BDD spec — `EditContent` rejects a deleted note
- [ ] BDD projection specs: note absent from `NoteTitleList` and `NoteDetail` after `NoteDeleted`
- [ ] `DELETE /notes/{id}` returns `204`; `404` for non-existent; `GET /notes/{id}` returns `404` after delete; `GET /notes` omits deleted note
- [ ] API integration tests and acceptance tests: all four HTTP assertions green

*Frontend:*
- [ ] `api.ts` — `deleteNote(noteId)` calls `DELETE /notes/{id}`
- [ ] `NoteView` has a "Delete" button (or menu item) that calls `deleteNote` with a confirmation step
- [ ] On successful delete, the note is removed from the in-memory list and the UI navigates back to the list view
- [ ] The deleted note is not visible in the list after deletion (no page refresh required)
- [ ] On delete failure, an error is surfaced and the note remains in the list
- [ ] E2E journey: create a note, open it, delete it — note is gone from the list; navigating directly to the note URL shows a not-found state

---

## Slice 2-E — Projection rebuild
**Status:** Not Started

**Value:** The read side can be fully recovered by replaying the event log — proves the durability promise of event sourcing and closes the gap where notes created before a projection existed are invisible.

**Design:** `IEventStore` gains `ReadAllStreamsAsync()`. Each projection gains `Reset()` / `DeleteAllAsync()`. An admin endpoint triggers reset → fold → upsert.

**Acceptance criteria:**

*Backend:*
- [ ] `IEventStore` extended with `ReadAllStreamsAsync(CancellationToken)` returning `IAsyncEnumerable<EventEnvelope>`
- [ ] `DynamoDbEventStore` implements `ReadAllStreamsAsync` with `Scan` + pagination
- [ ] `InMemoryEventStore` implements `ReadAllStreamsAsync` for integration tests
- [ ] `NoteTitleListProjection` and `NoteDetailProjection` gain `Reset()`; stores gain `DeleteAllAsync()`
- [ ] `POST /admin/rebuild-projections`: resets both stores, folds all events, returns `200`
- [ ] After rebuild, `GET /notes` reflects the full event history
- [ ] `EventStoreIntegration` spec: `ReadAllStreamsAsync` returns events from multiple streams in correct order
- [ ] API integration spec: rebuild returns `200`; `GET /notes` then includes a note absent from the initial projection
- [ ] Acceptance spec: rebuild + `GET /notes` consistent with event log

*Frontend:*
- [ ] No user-facing UI — rebuild is an admin/ops operation invoked via the API directly
- [ ] Verify: after a rebuild in the deployed environment, the note list renders correctly with no UI changes needed

*Note: this is primarily a backend/ops slice. The "full-stack" acceptance is confirming the UI requires no changes.*
