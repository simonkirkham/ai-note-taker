# Phase 2 — Richer Note Lifecycle

**Goal:** you've changed your mind about an event's shape at least once and survived. By the end of this phase a user can write content into a note, delete notes they no longer need, and the projection can be rebuilt from scratch — covering event versioning, soft delete, and projection rebuild as deliberate learning targets.

**Scope note:** The roadmap lists `NoteDeleted`, `NoteContentReplaced`, and event versioning as Phase 2 work. `NoteContentReplaced` was resolved to `ContentEdited` (full snapshot) in the event model. Phase 2 delivers five slices: NoteDetail projection, EditContent, event versioning, DeleteNote, and projection rebuild. Acceptance criteria are written as user behaviour — what the user does and sees. Most slices involve UI work; where they don't, the reason is stated explicitly.

Status key: `Done` · `In Progress` · `Not Started`

---

## Slice 2-A — Load and display note content
**Status:** Done

**Value:** Users can open a note and see its content — the app graduates from "a list of titles" to "something you can actually read."

**Commands in scope:** none (read-side only)
**Events subscribed:** `NoteCreated`, `NoteRenamed`, `ContentEdited`

**Acceptance criteria:**

- [x] *(backend done)* The note detail (title, content, timestamps) is stored and retrievable by note ID
- [x] User opens a note from the list — the note's content is displayed below the title
- [x] While the note is loading, a loading indicator is visible
- [x] User opens a note that has no content yet — an empty content area is shown (not an error)
- [x] E2E: create a note, save content via the API directly, open the note in the browser — the content is visible without a page refresh

---

## Slice 2-B — Write and save note content
**Status:** Done

**Value:** Users can type meeting notes and have them saved automatically — the core use case of the app.

**Commands in scope:** `EditContent`
**Events in scope:** `ContentEdited`

**Acceptance criteria:**

- [x] *(backend done)* Submitting content for a note persists it and returns it on subsequent fetches
- [x] User opens a note — a textarea is shown pre-populated with any previously saved content
- [x] User types in the textarea and moves focus away — the content is saved without any manual action
- [x] User navigates back to the list and re-opens the note — the typed content is still there
- [x] User clears the textarea and blurs — the empty content is saved (not an error)
- [x] E2E: open a note, type content, blur, navigate away, re-open — content persists across navigation

---

## Slice 2-C — Event versioning
**Status:** Done

**Value:** The project survives its first event shape change without losing history — the defining "trust the event log" moment of event sourcing.

**Design:** `ContentEdited` v2 adds `CharacterCount: int` (auto-computed from `Content.Length`). Existing v1 events remain readable. `EventDeserializer` routes by `EventVersion`. `NoteDetailProjection` handles both versions gracefully.

**Events in scope:** `ContentEdited` v2 (new shape); v1 remains readable

**Acceptance criteria:**

*Backend:*
- [x] User opens a note that was saved before the versioning change — content still loads and displays correctly
- [x] User saves new content after the deploy — it saves and reloads correctly
- [x] *(internal)* The event stream contains both v1 and v2 `ContentEdited` events; the system handles both without error

*Note: this is a backend learning slice — no visible UI change. The acceptance criteria confirm the UI is unbroken across the version boundary.*

---

## Slice 2-D — Delete a note
**Status:** Not Started

**Value:** Users can remove notes they no longer need — keeps the list clean and teaches soft delete in an event-sourced system.

**Design:** prune-on-event — `NoteTitleListProjection` and `NoteDetailProjection` hard-delete their DynamoDB rows when `NoteDeleted` fires. The event stream retains the full history.

**Commands in scope:** `DeleteNote`
**Events in scope:** `NoteDeleted`

**Acceptance criteria:**

- [ ] User opens a note and chooses to delete it — the note disappears from the list immediately, no page refresh needed
- [ ] User navigates back to the list after deleting — the deleted note is not there
- [ ] User tries to re-open a deleted note's URL directly — a not-found message is shown
- [ ] *(internal)* Renaming or editing a deleted note is rejected by the backend
- [ ] E2E: create a note, open it, delete it — gone from list; direct URL shows not-found

---

## Slice 2-E — Projection rebuild
**Status:** Not Started

**Value:** The read side can be fully recovered by replaying the event log — proves the durability promise of event sourcing and closes the gap where notes created before a projection existed are invisible.

**Design:** `IEventStore` gains `ReadAllStreamsAsync()`. Each projection gains `Reset()` / `DeleteAllAsync()`. An admin endpoint triggers reset → fold → upsert.

**Acceptance criteria:**

- [ ] After triggering a rebuild, all notes that exist in the event log are visible in the list — including any that were created before the projection table existed
- [ ] The note list renders correctly after a rebuild — no UI changes required
- [ ] *(internal)* The rebuild endpoint resets both projections and replays all events from the event store

*Note: rebuild is an admin/ops operation with no user-facing UI. The acceptance criteria confirm the list is correct after a rebuild is run externally.*
