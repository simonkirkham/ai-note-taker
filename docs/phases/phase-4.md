# Phase 4 — UX Redesign (wireframe alignment)

**Goal:** Bring the app's layout and interaction model in line with the wireframes in `docs/wireframes/`. This phase is primarily frontend-driven, with backend additions where the wireframe requires data the API does not yet expose. No new aggregates are introduced; the primary backend learning surface is **projection evolution** (extending `NoteDetail`, adding `NoteCardList`).

## Summary

| Slice | Summary                           | Status | Depends on |
| ----- | --------------------------------- | ------ | ---------- |
| 4-A   | Settable note date                | Done   | —          |
| 4-B   | Note screen layout redesign       | Done   | —          |
| 4-C   | Implicit action item add          | Done   | —          |
| 4-D   | Persistent note list sidebar      | Done   | —          |
| 4-E   | Note summary cards on home screen | Done   | 4-A        |
| 4-F   | Expandable completed todos        | Done   | —          |

4-E must land after 4-A so the `NoteCardList` projection can handle `NoteDateSet` and the card schema includes `Date`.

---

## Slice 4-A — Settable note date

**Status:** Done

### Scenarios

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

### Acceptance criteria

- [x] _(internal)_ Setting a date appends `NoteDateSet` to the event store
- [x] _(internal)_ Setting a date on a non-existent note returns 404
- [x] User sees a date input field top-right of the note header; it is empty by default
- [x] User sets a date — it is shown (formatted DD/MM/YYYY) and persists on navigation
- [x] User clears the date — field returns to empty and persists as empty on navigation
- [x] E2E: create a note, set a date, navigate away and back — date still shown

---

## Slice 4-B — Note screen layout redesign

**Status:** Done

### Scenarios

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

### Acceptance criteria

- [x] Content textarea is visually enclosed in a bordered box with "Captured Notes" label above it
- [x] On viewports ≥768px: actions panel is to the right of the content, both visible simultaneously
- [x] On viewports <768px: actions panel stacks below content; no horizontal scroll
- [x] Back button, Delete Note button, and title input remain at the top of the screen
- [x] All existing action item operations (add, complete, delete) continue to work
- [x] E2E: open a note, add an action item in the new layout — it appears in the right panel

---

## Slice 4-C — Implicit action item add

**Status:** Done

### Scenarios

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

### Acceptance criteria

- [x] Pressing Enter in a non-empty action input submits the item and clears the field
- [x] Blurring a non-empty action input submits the item
- [x] Blurring an empty action input does nothing
- [x] The "Add" button is removed from the UI
- [x] E2E: open a note, type an action item, press Enter — item appears; type another, click elsewhere — item appears

---

## Slice 4-D — Persistent note list sidebar

**Status:** Done

### Scenarios

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

### Acceptance criteria

- [x] Left sidebar renders note names on both the home screen and note screen
- [x] Clicking a sidebar entry navigates to that note from any screen
- [x] Active note is visually highlighted in the sidebar when on the note screen
- [x] Creating a new note adds it to the sidebar immediately
- [x] On viewports <640px: sidebar is hidden with a reveal toggle; no horizontal scroll
- [x] E2E: home screen shows note names in sidebar; clicking one opens the note; note screen sidebar still visible

---

## Slice 4-E — Note summary cards on home screen

**Status:** Done

### Scenarios

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

### Acceptance criteria

- [x] _(internal)_ `NoteCardList` projection folds `NoteCreated`, `NoteRenamed`, `ContentEditedV2`, `NoteDateSet`, `NoteDeleted`, `ActionItemAdded`, `ActionItemCompleted`, `ActionItemReopened`, `ActionItemDeleted` correctly
- [x] `GET /notes/cards` returns title, date, content snippet (≤120 chars), open action descriptions, for each active note
- [x] Home screen renders a card per note (not a plain list)
- [x] Each card shows: title, formatted date (or blank), content snippet, open action items, "Edit Note" button
- [x] "Edit Note" navigates to the note screen for that note
- [x] Cards are ordered newest-first
- [x] E2E: create a note with title, content, and an action item — the home screen card shows all three

---

## Slice 4-F — Expandable completed todos

**Status:** Done

### Scenarios

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

### Acceptance criteria

- [x] _(internal)_ `GET /todos/completed` returns completed action items with description, noteTitle, completedAt
- [x] Home screen To Do section shows a "Show completed (N)" toggle when N > 0
- [x] Expanding the toggle reveals completed items with their parent note title
- [x] Collapsing hides them; state resets to collapsed on page reload
- [x] E2E: complete an action item; go home; click "Show completed" — item visible with note title; click again — collapses
