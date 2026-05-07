# Phase 4 — UX Redesign (wireframe alignment)

**Goal:** Bring the app's layout and interaction model in line with the wireframes in `docs/wireframes/`. This phase is primarily frontend-driven, with backend additions where the wireframe requires new data the API does not yet expose. No new aggregates are introduced; the learning surface is projection evolution and frontend architecture patterns.

**Wireframe references:**
- `docs/wireframes/Note Screen.png` — two-column layout, bordered content area, right-panel actions, date top-right
- `docs/wireframes/Homescreen with note summary.png` — left sidebar note list, To Do section, note summary cards with content snippet + actions + tags + date

**Scope note:** Tags appear prominently in the wireframes but are deferred to Phase 5 (Folders and tags). Each slice below delivers a visible, testable UX improvement. Backend slices (4-A, 4-E, 4-F) follow the standard BDD-first, event-sourced pattern; frontend-only slices (4-B, 4-C, 4-D) have E2E acceptance criteria but no domain BDD specs.

---

## Slice 4-A — Settable note date

**Status:** Not Started

**Value:** Every note can be stamped with a meeting date. The date is visible top-right on the note screen and on the home summary cards — matching the wireframe and making notes temporally navigable.

**Commands in scope:** `SetNoteDate(NoteId, Date)`
**Events in scope:** `NoteDateSet { NoteId, Date }`
**Projections in scope:** `NoteDetail` (add `Date?`), `NoteTitleList` (add `Date?` for later use by 4-E cards)

**Scenarios:**

```
Scenario: Set a date on a note
  Given I am viewing a note
  When  I click the date field and set it to 21/04/2026
  Then  the date "21/04/2026" is shown in the note header

Scenario: Date persists across navigation
  Given I have set a date on a note
  When  I navigate away and return
  Then  the date is still shown

Scenario: Date is empty by default
  Given a newly created note
  When  I view it
  Then  the date field is empty (not today's date)

Scenario: Unset a date (clear it)
  Given a note has a date set
  When  I clear the date field
  Then  the date field becomes empty
```

**Acceptance criteria:**

- [ ] *(internal)* Setting a date appends `NoteDateSet` to the event store
- [ ] *(internal)* A note without a date returns `null` for the date field in `GET /notes/{id}`
- [ ] User sees a date field (input type="date") top-right of the note header
- [ ] User sets a date — it is shown formatted (DD/MM/YYYY) and persists on navigation
- [ ] User clears the date — field returns to empty, persists on navigation
- [ ] E2E: create a note, set a date, navigate away and back — date still shown

---

## Slice 4-B — Note screen layout redesign

**Status:** Not Started

**Value:** The note screen matches the wireframe: a two-column layout with the content area on the left (in a bordered box) and a right panel containing the actions list. The layout is cleaner and reduces vertical scrolling.

**Commands in scope:** none
**Events in scope:** none
**Projections in scope:** none (frontend layout change only)

**Scenarios:**

```
Scenario: Note content area has a visible border
  Given I open a note
  Then  the content textarea is visually enclosed in a bordered box

Scenario: Actions panel is to the right of the content
  Given I open a note with action items
  Then  the actions list appears in a right-side panel, not below the content

Scenario: Layout is responsive — stacks vertically on narrow viewports
  Given I am viewing the note on a narrow screen (< 640px)
  Then  the actions panel stacks below the content area
```

**Acceptance criteria:**

- [ ] Content textarea has a visible box border (matching wireframe style)
- [ ] On wide viewports (≥ 768px): actions panel is to the right of content, both visible simultaneously
- [ ] On narrow viewports (< 768px): actions panel stacks below content (no horizontal scroll)
- [ ] "Captured Notes" section label appears above the content area
- [ ] All existing action item functionality (add, complete, delete, reopen) continues to work in the new layout
- [ ] E2E: open a note, add an action item — it appears in the right panel; complete it — state updates correctly

---

## Slice 4-C — Implicit action item add

**Status:** Not Started

**Value:** Action items can be added by pressing Enter or clicking away from the input — matching the wireframe which shows no visible "Add" button. This reduces the number of interactions required to capture a thought.

**Commands in scope:** none (reuses `AddActionItem`)
**Events in scope:** none
**Projections in scope:** none (frontend UX change only)

**Scenarios:**

```
Scenario: Press Enter to add an action item
  Given I am in the action input
  When  I type "Send recap email" and press Enter
  Then  "Send recap email" appears in the actions list
  And   the input is cleared and focused for the next item

Scenario: Blur (click away) adds a non-empty action item
  Given I have typed "Book room" in the action input
  When  I click outside the input (blur)
  Then  "Book room" is added to the actions list

Scenario: Blur on empty input does nothing
  Given the action input is empty
  When  I click outside the input
  Then  no action item is added and no error appears

Scenario: Add button is removed
  Given I am viewing a note
  Then  no "Add" button is visible next to the action input
```

**Acceptance criteria:**

- [ ] Pressing Enter in a non-empty action input submits the item and clears the field
- [ ] Blurring a non-empty action input submits the item
- [ ] Blurring an empty action input does nothing
- [ ] The "Add" button is removed from the UI
- [ ] E2E: open a note, type an action item, press Enter — item appears; type another, click elsewhere — item appears

---

## Slice 4-D — Persistent note list sidebar

**Status:** Not Started

**Value:** A narrow left sidebar showing all note names is visible on both the home screen and the note screen, matching the wireframe. Users can jump between notes without going back to a list view.

**Commands in scope:** none
**Events in scope:** none
**Projections in scope:** none (reuses existing `GET /notes`)

**Scenarios:**

```
Scenario: Note names appear in the left sidebar on the home screen
  Given I have three notes
  When  I view the home screen
  Then  a left sidebar shows all three note names

Scenario: Clicking a sidebar note name opens that note
  Given the left sidebar is visible
  When  I click a note name
  Then  the note screen opens for that note

Scenario: The sidebar is visible on the note screen
  Given I am viewing a note
  Then  the note sidebar is still visible on the left

Scenario: Sidebar collapses on narrow viewports
  Given I am on a narrow screen (< 640px)
  Then  the sidebar is hidden by default
  And   a toggle button reveals it
```

**Acceptance criteria:**

- [ ] Left sidebar renders note names on the home screen (replaces / supplements the current flat list)
- [ ] Left sidebar renders note names on the note screen
- [ ] Clicking a sidebar entry navigates to that note (from any screen)
- [ ] Active note is visually highlighted in the sidebar
- [ ] On narrow viewports (< 640px): sidebar is hidden by default with a reveal toggle
- [ ] E2E: home screen shows note names in sidebar; clicking one opens the note; note screen still shows sidebar

---

## Slice 4-E — Note summary cards on home screen

**Status:** Not Started

**Value:** The "Notes" section on the home screen shows rich summary cards (title, date, content snippet, open action count, Edit Note button) instead of a plain list. This matches the wireframe and gives users a quick overview of each note's content without opening it.

**Commands in scope:** none
**Events in scope:** none (reads from existing events)
**Projections in scope:** New `NoteCard` projection — aggregates title, date, content snippet, open action count per note into a single DynamoDB table; handles `NoteCreated`, `NoteRenamed`, `ContentEditedV2`, `NoteDateSet`, `NoteDeleted`, `ActionItemAdded`, `ActionItemCompleted`, `ActionItemReopened`, `ActionItemDeleted`

**Dependencies:** 4-A must be complete (date field on note)

**Backend changes:** New `GET /notes/cards` endpoint returning card data; new CDK table for `NoteCard` projection.

**Scenarios:**

```
Scenario: Home screen shows note summary cards
  Given I have a note titled "Q1 Review" with content "Lorem ipsum" and one open action
  When  I view the home screen
  Then  a card shows "Q1 Review", a content snippet, "1 action", and an Edit Note button

Scenario: Card date matches the note date
  Given a note has date set to 21/04/2026
  When  I view the home screen
  Then  the card shows "21/04/2026"

Scenario: Card content snippet truncates long content
  Given a note has 500 words of content
  When  I view the home screen
  Then  the snippet shows approximately the first 100 characters followed by "…"

Scenario: Completed or deleted action items do not count toward the open action count
  Given a note has 2 open and 1 completed action item
  When  I view the home screen card
  Then  it shows "2 actions"
```

**Acceptance criteria:**

- [ ] *(internal)* `NoteCard` projection handles all relevant events and produces correct card data
- [ ] `GET /notes/cards` returns title, date, content snippet (≤ 120 chars), open action count per note
- [ ] Home screen renders note summary cards (not a plain list)
- [ ] Each card shows: title, formatted date (or blank), content snippet, open action count, "Edit Note" button
- [ ] "Edit Note" button navigates to the note screen
- [ ] Cards are ordered by note creation date (newest first)
- [ ] E2E: create a note with title, content, and an action item; home screen card shows all three

---

## Slice 4-F — Expandable completed todos

**Status:** Not Started

**Value:** The To Do list on the home screen has a collapsed "Completed" section that can be expanded to show action items that have been ticked off. Users can review what's been done without completed items cluttering the open list.

**Commands in scope:** none
**Events in scope:** none
**Projections in scope:** none new; adds `GET /todos/completed` endpoint that queries `NoteActions` across all notes for completed items (DynamoDB scan with filter expression on `Completed = true`).

**Scenarios:**

```
Scenario: Completed section is collapsed by default
  Given I have completed one action item
  When  I view the home screen
  Then  the "To Do" section shows open items only
  And   a "Show completed (1)" link/button is visible

Scenario: Expanding shows completed items
  Given I click "Show completed"
  Then  completed action items appear below the open list
  And   each shows the note title it belongs to

Scenario: Collapsing hides completed items again
  Given the completed section is expanded
  When  I click "Hide completed"
  Then  completed items are hidden again

Scenario: No completed section if nothing is completed
  Given no action items have been completed
  Then  no "Show completed" toggle is visible
```

**Acceptance criteria:**

- [ ] *(internal)* `GET /todos/completed` returns completed action items with `description`, `noteTitle`, `completedAt`, sorted by `completedAt` descending
- [ ] Home screen To Do section has a "Show completed (N)" toggle (hidden if N = 0)
- [ ] Expanding the toggle reveals completed action items with their parent note title
- [ ] Collapsing hides them again (state is not persisted — defaults to collapsed on reload)
- [ ] E2E: complete an action item, go home, click "Show completed" — item is visible with correct note title; click again — it collapses
