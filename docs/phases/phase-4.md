# Phase 4 — UX Redesign (wireframe alignment)

**Goal:** Bring the app's layout and interaction model in line with the wireframes in `docs/wireframes/`. This phase is primarily frontend-driven, with backend additions where the wireframe requires data the API does not yet expose. No new aggregates are introduced; the primary backend learning surface is **projection evolution** (extending `NoteDetail`, adding `NoteCardList`).

**Wireframe references:**
- `docs/wireframes/Note Screen.png` — two-column layout; content area left in a bordered box; tags and actions in right panel; note title + date in header
- `docs/wireframes/Homescreen with note summary.png` — left sidebar with note names; To Do section; rich note cards showing title, date, content snippet, open actions, tags, "Edit Note" button

**Design already done:** `NoteDateSet`, `NoteCardList`, `TagIndex` are all specified in `docs/event-model.md`, `docs/event-schemas.md`, and `docs/view-schemas.md`. Phase 4 implements what those documents already describe. Tags are deferred to Phase 5 — they appear in the wireframe but are not in scope here.

**Scope note (tags):** The wireframe shows a tags panel on the note screen and tag pills on home screen cards. Tags are deferred to Phase 5 (Folders and tags). Tag areas will be rendered as empty placeholders in Phase 4.

**Doc/code divergence to fix before Breaker starts:**
The event model uses `ActionItemRemoved` / `RemoveActionItem`; the Phase 3 implementation used `ActionItemDeleted` / `DeleteActionItem`. Pip must update `docs/event-model.md` and `docs/event-schemas.md` at the start of the first slice to reconcile this before any new test references the wrong name.

---

## Slice order and dependencies

```
4-A  Note date  ─────────────────────┐
4-B  Note screen layout (frontend)   │  (independent)
4-C  Implicit action add (frontend)  │  (independent)
4-D  Sidebar (frontend)              │  (independent)
4-E  Note summary cards  ────────────┘  (depends on 4-A: cards show date)
4-F  Expandable completed todos         (independent)
```

4-E must land after 4-A so the `NoteCardList` projection can handle `NoteDateSet` and the card schema includes `Date`.

---

## Slice 4-A — Settable note date

**Status:** Done

**Value:** A note can be stamped with a meeting date — the most natural metadata for a meeting notes tool. The date is visible top-right on the note screen and feeds the summary cards in 4-E.

**Commands in scope:** `SetNoteDate(noteId, date, setAt)`
**Events in scope:** `NoteDateSet { NoteId, Date }` (type: `DateOnly`)
**Projections in scope:**
- `NoteDetail` — add `Date? DateOnly` field; handle `NoteDateSet`
- `NoteTitleList` — no change needed for 4-A (date will be picked up by `NoteCardList` in 4-E)

**Wire shape:** already defined in `docs/event-schemas.md`. `date` serialises as `yyyy-MM-dd`. Payload: `{ "noteId": "...", "date": "2026-04-21" }`.

**View schema change:** `NoteDetail` needs `Date? DateOnly` added — update `docs/view-schemas.md`.

**API endpoint:** `PATCH /notes/{noteId}/date` — body `{ "date": "2026-04-21" }` (or `{ "date": null }` to clear). Returns 200 on success, 404 if note not found.

**REST note:** `noteId` in `PATCH /notes/{noteId}/date` is consumed by the `Note` aggregate — not a structural-only param.

**Implementation files (Pip):**
- `src/Domain/Notes/NoteCommands.cs` — add `record SetNoteDate(NoteId NoteId, DateOnly Date)`
- `src/Domain/Notes/NoteEvents.cs` — add `record NoteDateSet(NoteId NoteId, DateOnly Date)`
- `src/Domain/Notes/Note.cs` — add `_date` state, `Apply(NoteDateSet)`, `HandleSetDate`
- `src/EventStore/EventDeserializer.cs` — route `NoteDateSet`
- `src/EventStore/Projections/NoteDetailProjection.cs` — add `Date?` to `NoteDetail` record, handle `NoteDateSet`
- `src/Api/NoteCommandHandler.cs` — add `HandleAsync(SetNoteDate cmd)`
- `src/Api/Handlers/NoteHandlers.cs` — add `SetNoteDate` HTTP handler
- `src/Api/Endpoints/NoteEndpoints.cs` — register `PATCH /notes/{noteId}/date`
- `tests/ApiIntegration/InMemoryNoteDetailStore.cs` — may need to extend in-memory store
- `web/src/api.ts` — add `setNoteDate(noteId, date)` function
- `web/src/components/NoteView.tsx` — add date input in note header
- `web/src/App.css` — style the date input field

**Layer split:** Yes — 6 acceptance criteria, new event + backend + E2E. Batch 1: domain BDD + API integration. Batch 2: E2E + frontend.

**Scenarios:**

```
Scenario: Set a date on a note
  Given I am viewing a note
  When  I click the date field and select 21/04/2026
  Then  the date "21/04/2026" is displayed in the note header

Scenario: Date persists across navigation
  Given I have set a date on a note
  When  I navigate away and return to the note
  Then  the date "21/04/2026" is still shown

Scenario: New note has no date by default
  Given I create a new note
  Then  the date field is empty (not prefilled with today)

Scenario: Date can be cleared
  Given a note has date "21/04/2026" set
  When  I clear the date field and save
  Then  the date field is empty and persists as empty on navigation

Scenario: Set date on non-existent note (API)
  Given no note exists with the given noteId
  When  PATCH /notes/{noteId}/date with a valid date
  Then  the response is 404 Not Found
```

**Acceptance criteria:**

- [x] *(internal)* Setting a date appends `NoteDateSet` to the event store
- [x] *(internal)* Setting a date on a non-existent note returns 404
- [x] User sees a date input field top-right of the note header; it is empty by default
- [x] User sets a date — it is shown (formatted DD/MM/YYYY) and persists on navigation
- [x] User clears the date — field returns to empty and persists as empty on navigation
- [x] E2E: create a note, set a date, navigate away and back — date still shown

---

## Slice 4-B — Note screen layout redesign

**Status:** Done

**Value:** The note screen matches the wireframe: content in a bordered left area, actions in a right panel, a "Captured Notes" label above the content. Reading notes and capturing actions no longer requires scrolling past each other.

**Commands in scope:** none
**Events in scope:** none
**New backend:** none — pure frontend layout change

**Implementation files (Pip):**
- `web/src/components/NoteView.tsx` — restructure to two-column layout; add "Captured Notes" label; wrap textarea in bordered container; move `<ActionsSection>` to right column
- `web/src/App.css` — new layout classes: `.note-layout` (two-column grid), `.note-content-panel` (left, with border), `.note-right-panel` (right)

**Responsive behaviour:** ≥768px: side-by-side columns. <768px: actions panel stacks below content (no horizontal scroll).

**Scenarios:**

```
Scenario: Content area has a visible border
  Given I open a note
  Then  the "Captured Notes" label is visible above a bordered text area

Scenario: Actions panel is to the right of the content on wide screens
  Given I open a note with an action item on a desktop viewport
  Then  the actions panel is visible to the right of the content area simultaneously

Scenario: Layout stacks vertically on narrow screens
  Given I am viewing the note on a viewport narrower than 768px
  Then  the actions panel appears below the content area, with no horizontal scroll

Scenario: All existing note functionality still works
  Given I am in the new layout
  When  I add, complete, and delete an action item
  Then  all three operations work as before
```

**Acceptance criteria:**

- [x] Content textarea is visually enclosed in a bordered box with "Captured Notes" label above it
- [x] On viewports ≥768px: actions panel is to the right of the content, both visible simultaneously
- [x] On viewports <768px: actions panel stacks below content; no horizontal scroll
- [x] Back button, Delete Note button, and title input remain at the top of the screen
- [x] All existing action item operations (add, complete, delete) continue to work
- [x] E2E: open a note, add an action item in the new layout — it appears in the right panel

---

## Slice 4-C — Implicit action item add

**Status:** Done

**Value:** Action items are captured the moment thought meets keyboard — press Enter and the item is captured immediately. No "Add" button to reach for. This matches the wireframe (no button visible in the actions box) and removes friction from the most common interaction.

**Commands in scope:** none (reuses `AddActionItem`)
**Events in scope:** none
**New backend:** none — frontend UX change only

**Implementation files (Pip):**
- `web/src/components/ActionsSection.tsx` — replace `<form onSubmit>` with `onKeyDown` (Enter) and `onBlur` handlers; remove the `<button data-testid="add-action-button">` element
- `web/src/App.css` — remove `.action-form` / `.add-action-button` styles (or repurpose the input container)

**Risk:** Removing `data-testid="add-action-button"` will break `AppPage.AddActionItemAsync()` in E2E. Pip must update the page object to use keyboard trigger instead. Breaker should write the updated page object helper before Pip implements.

**Scenarios:**

```
Scenario: Enter key adds an action item
  Given I have typed "Send recap email" in the action input
  When  I press the Enter key
  Then  "Send recap email" appears in the actions list
  And   the input is cleared and ready for the next item

Scenario: Clicking away adds a non-empty action item
  Given I have typed "Book the room" in the action input
  When  I click outside the input (blur event fires)
  Then  "Book the room" is added to the actions list

Scenario: Clicking away on an empty input does nothing
  Given the action input is empty
  When  I click outside the input
  Then  no action item is added and no error is shown

Scenario: No "Add" button is visible
  Given I am on the note screen
  Then  there is no "Add" button next to the action input
```

**Acceptance criteria:**

- [ ] Pressing Enter in a non-empty action input submits the item and clears the field
- [ ] Blurring a non-empty action input submits the item
- [ ] Blurring an empty action input does nothing
- [ ] The "Add" button is removed from the UI
- [ ] E2E: open a note, type an action item, press Enter — item appears; type another, click elsewhere — item appears

---

## Slice 4-D — Persistent note list sidebar

**Status:** Done

**Value:** A left sidebar showing all note names is visible on both the home screen and the note screen, matching the wireframe. Users can jump between notes without going back to a list view.

**Commands in scope:** none
**Events in scope:** none
**New backend:** none — reuses `GET /notes` via the existing `useNotes` hook

**Implementation files (Pip):**
- `web/src/components/Sidebar.tsx` — new component: receives `notes`, `activeNoteId?`, `onSelect(noteId)`, `onCreate()`; renders note name list; highlights active entry; "New Note" button at bottom or top
- `web/src/App.tsx` — restructure to two-column app layout (sidebar always visible); pass `notes` and `onOpen` to `Sidebar`
- `web/src/components/ListView.tsx` — remove flat note list (sidebar replaces it); keep "Home" heading, To Do section, and note cards section
- `web/src/App.css` — new layout classes: `.app-layout` (sidebar + main), `.sidebar` (narrow left column), `.sidebar-note-item`, `.sidebar-note-item--active`

**Responsive:** sidebar hidden by default on <640px; a toggle button (hamburger or `›`) reveals it as an overlay.

**Existing E2E compatibility:** `AppPage.ClickNoteInListAsync` uses `page.GetByTestId("note-list").GetByText(title)`. If the sidebar replaces `note-list`, the test ID must be updated or the sidebar must carry `data-testid="note-list"`. Breaker must update `AppPage` before Pip implements.

**Scenarios:**

```
Scenario: Note names appear in the left sidebar on the home screen
  Given I have two notes titled "Q1 Review" and "1:1 Bill"
  When  I view the home screen
  Then  both names appear in the left sidebar

Scenario: Clicking a sidebar entry opens that note
  Given the sidebar is visible
  When  I click "Q1 Review" in the sidebar
  Then  the note screen opens for "Q1 Review"

Scenario: Active note is highlighted in the sidebar on the note screen
  Given I have opened "Q1 Review"
  Then  "Q1 Review" appears highlighted in the sidebar

Scenario: Sidebar note list updates after creating a new note
  Given I click "New Note"
  When  the new note is created and its title is set to "Budget 2027"
  Then  "Budget 2027" appears in the sidebar

Scenario: Sidebar is hidden by default on narrow screens
  Given I am on a viewport narrower than 640px
  Then  the sidebar is not visible by default
  And   a toggle button is present that reveals it
```

**Acceptance criteria:**

- [ ] Left sidebar renders note names on both the home screen and note screen
- [ ] Clicking a sidebar entry navigates to that note from any screen
- [ ] Active note is visually highlighted in the sidebar when on the note screen
- [ ] Creating a new note adds it to the sidebar immediately
- [ ] On viewports <640px: sidebar is hidden with a reveal toggle; no horizontal scroll
- [ ] E2E: home screen shows note names in sidebar; clicking one opens the note; note screen sidebar still visible

---

## Slice 4-E — Note summary cards on home screen

**Status:** Done

**Value:** The Notes section on the home screen shows rich summary cards — title, meeting date, content snippet, open action items, and an "Edit Note" button — exactly as in the wireframe. Users can assess any note without opening it.

**Commands in scope:** none
**Events in scope:** none (folds over existing events)
**Projections in scope:** New `NoteCardList` projection — full schema defined in `docs/view-schemas.md`. **Extend that schema to add `Date? DateOnly`** before Breaker writes tests.

**Dependencies:** 4-A must land first (date field in the card).

**API endpoint:** `GET /notes/cards` — returns `{ "cards": [...] }` as specified in `docs/view-schemas.md`. Ordered by `CreatedAt` descending (newest first). Tags array included in storage and wire shape but rendered as empty until Phase 5 lands.

**CDK changes:** New DynamoDB table `notetaker-proj-notecardlist` (PK: NoteId string, no sort key). New Lambda env var `PROJ_NOTECARDLIST_TABLE_NAME`. New `GrantReadWriteData` call. IAM assertions test needs updating.

**NoteCardList event handlers** (from `docs/view-schemas.md`, also handling `ActionItemDeleted` from Phase 3):
- `NoteCreated` → upsert row
- `NoteRenamed` → update Title
- `ContentEditedV2` → update Content (truncate to 200 chars for storage; trim further at read time for the preview)
- `NoteDateSet` → update Date
- `NoteDeleted` → set Deleted = true
- `ActionItemAdded` → append to ActionItems list
- `ActionItemCompleted` → mark item completed
- `ActionItemReopened` → mark item open
- `ActionItemDeleted` → remove from ActionItems list

**Wire JSON:** as documented in `docs/view-schemas.md`, with `date` added: `"date": "2026-04-21"` or `"date": null`.

**Implementation files (Pip):**
- `src/EventStore/Projections/NoteCardListProjection.cs` — new file: `NoteCardListProjection`, `INoteCardListStore`, `DynamoDbNoteCardListStore`
- `src/Api/Builder.cs` or `Program.cs` — wire `INoteCardListStore` → `DynamoDbNoteCardListStore`
- `src/Api/Handlers/NoteHandlers.cs` — add `GetNoteCards` handler
- `src/Api/Endpoints/NoteEndpoints.cs` — register `GET /notes/cards`
- `src/Infrastructure/NoteTakerStack.cs` — new CDK table + env var + IAM grant
- `tests/ApiIntegration/InMemoryNoteCardListStore.cs` — new in-memory implementation
- `tests/InfraAssertions/` — update CDK assertion for new table
- `web/src/api.ts` — add `getNoteCards()` returning `NoteCard[]`
- `web/src/components/NoteCard.tsx` — new card component (title, date, snippet, actions, Edit button)
- `web/src/components/ListView.tsx` — replace flat note list with `NoteCard` grid/list
- `web/src/App.css` — `.note-card`, `.note-card-header`, `.note-card-snippet`, `.note-card-actions`

**Layer split:** Required — new projection + CDK + E2E, ≥6 acceptance criteria.
- Batch 1: domain projection specs, API integration tests, CDK assertions
- Batch 2: E2E + frontend component

**Scenarios:**

```
Scenario: Home screen shows a summary card for each note
  Given I have a note titled "Q1 Review" with content "Lorem ipsum" and one open action "Send agenda"
  When  I view the home screen
  Then  a card shows "Q1 Review", a content snippet, "Send agenda" in the actions, and an Edit Note button

Scenario: Card shows meeting date when set
  Given a note has date set to 21/04/2026
  When  I view the home screen
  Then  the card shows "21/04/2026" in the top-right corner

Scenario: Card shows no date when unset
  Given a note has no date set
  Then  the card's date area is empty

Scenario: Content snippet truncates long content
  Given a note has content longer than 200 characters
  Then  the card shows a snippet ending with "…"

Scenario: Only open action items appear on the card
  Given a note has 2 open and 1 completed action item
  Then  the card shows 2 open actions (not the completed one)

Scenario: Edit Note button opens the note
  When  I click "Edit Note" on a card
  Then  the note screen opens for that note

Scenario: Card disappears when note is deleted
  Given a note card is visible on the home screen
  When  I open the note and delete it
  Then  the card is no longer visible on the home screen
```

**Acceptance criteria:**

- [x] *(internal)* `NoteCardList` projection folds `NoteCreated`, `NoteRenamed`, `ContentEditedV2`, `NoteDateSet`, `NoteDeleted`, `ActionItemAdded`, `ActionItemCompleted`, `ActionItemReopened`, `ActionItemDeleted` correctly
- [x] `GET /notes/cards` returns title, date, content snippet (≤120 chars), open action descriptions, for each active note
- [x] Home screen renders a card per note (not a plain list)
- [x] Each card shows: title, formatted date (or blank), content snippet, open action items, "Edit Note" button
- [x] "Edit Note" navigates to the note screen for that note
- [x] Cards are ordered newest-first
- [x] E2E: create a note with title, content, and an action item — the home screen card shows all three

---

## Slice 4-F — Expandable completed todos

**Status:** Not Started

**Value:** Completed action items are one tap away on the home screen — collapsed by default so they don't clutter the open list, but always accessible. Users can review what's been done across all notes without navigating into each one.

**Commands in scope:** none
**Events in scope:** none
**New projection:** none — reads from the existing `notetaker-proj-noteactions` DynamoDB table (scan with `Completed = true` filter expression, then batch-lookup titles from `notetaker-proj-notetitlelist`)

**API endpoint:** `GET /todos/completed` — returns `{ "items": [{ "actionId", "noteId", "noteTitle", "description", "completedAt" }] }`, ordered by `completedAt` descending.

**Backend implementation note:** `NoteActionsStore` scan with `FilterExpression = "Completed = :true"` returns rows across all notes. NoteId is in each row. A batch `GetItem` against `notetaker-proj-notetitlelist` resolves titles. No new DynamoDB table or CDK change needed.

**Implementation files (Pip):**
- `src/EventStore/Projections/NoteActionsProjection.cs` — add `QueryCompletedAsync` method to `INoteActionsStore` + `DynamoDbNoteActionsStore`
- `src/Api/Handlers/TodoHandlers.cs` — add `GetCompletedTodos` handler
- `src/Api/Endpoints/NoteEndpoints.cs` — register `GET /todos/completed`
- `tests/ApiIntegration/InMemoryNoteActionsStore.cs` — add `QueryCompletedAsync` to in-memory implementation
- `web/src/api.ts` — add `getCompletedTodos()` returning `CompletedTodoItem[]`
- `web/src/components/TodoSection.tsx` — add expand/collapse toggle; fetch completed on expand; render completed list below open list

**Layer split:** Borderline (4 criteria). Single batch acceptable given no new projection or CDK change.

**Scenarios:**

```
Scenario: "Show completed" toggle is visible when items exist
  Given I have completed one action item
  When  I view the home screen
  Then  the To Do section shows a "Show completed (1)" button

Scenario: No toggle when nothing is completed
  Given no action items have been completed
  Then  no "Show completed" toggle appears

Scenario: Expanding reveals completed items
  When  I click "Show completed"
  Then  completed action items appear below the open list
  And   each item shows its description and the parent note title

Scenario: Collapsing hides completed items
  Given the completed section is expanded
  When  I click "Hide completed"
  Then  the completed items are hidden

Scenario: Completing a todo from the home screen updates the count
  Given the completed section shows "Show completed (2)"
  When  I tick another open todo
  Then  the toggle updates to "Show completed (3)"
```

**Acceptance criteria:**

- [ ] *(internal)* `GET /todos/completed` returns completed action items with description, noteTitle, completedAt
- [ ] Home screen To Do section shows a "Show completed (N)" toggle when N > 0
- [ ] Expanding the toggle reveals completed items with their parent note title
- [ ] Collapsing hides them; state resets to collapsed on page reload
- [ ] E2E: complete an action item; go home; click "Show completed" — item visible with note title; click again — collapses

---

## Deferred to backlog (raised during Scout pass)

The following ideas surfaced during planning and are explicitly deferred. Added to `docs/backlog.md`.

- **Tags on note screen / home cards** — wireframe shows tags but Phase 5 owns this. Placeholder tag areas rendered in Phase 4.
- **"Close Note" replaces "← Back"** — wireframe uses "Close Note" button at bottom-right rather than a back button at top-left. Deferred to avoid scope creep in 4-B.
- **Touch target accessibility pass** — checkboxes and delete button below WCAG 44px minimum. Group fix for both across note screen and home screen.
- **SVG icons for delete and toggle** — currently using `×` and text labels.
- **Delete action from home screen** — already in backlog from Phase 3 planning.
