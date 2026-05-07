# Phase 3 — Cross-aggregate projection (todo list)

**Goal:** Introduce the `ActionItem` aggregate and demonstrate the defining power of event-sourced projections: the same stream of events feeds two completely different read models — a per-note actions panel and a cross-note todo list. By the end of this phase the user can add and complete action items inside a note, and see all open items from every note in a single list on the home screen.

**Scope note:** Phase 3 covers three commands (`AddActionItem`, `CompleteActionItem`, `ReopenActionItem`) and three events (`ActionItemAdded`, `ActionItemCompleted`, `ActionItemReopened`), plus `DeleteActionItem` / `ActionItemDeleted` in the final slice. Edit is deliberately deferred. Each slice is a full vertical cut — backend and frontend together, delivering observable user value. The contrast between 3-C and 3-A/3-B is the "power of projections" moment: the same events, a completely different read model shape.

**Dependencies and risks:**
- `ActionId` needs a strongly-typed value wrapper (like `NoteId`) — add it in `src/Domain/` at the start of 3-A.
- The `TodoList` handler for `ActionItemAdded` reads the parent note's title from the `NoteDetail` projection at write time (to denormalise it into the row). This is a cross-projection read at the projection layer — acceptable per `view-schemas.md` principles, but it means `NoteDetail` must be populated before a `TodoList` rebuild is meaningful. Flag in the implementation.
- `NoteActions` uses a composite DynamoDB key `(NoteId, ActionId)` — the CDK stack needs a new table with both PK and SK.
- `TodoList` uses `ActionId` as PK only — a single-key table, but needs a `NoteId` GSI for the `NoteRenamed` / `NoteDeleted` update sweep.

Status key: `Done` · `In Progress` · `Not Started`

---

## Slice 3-A — Add action items on the note screen

**Status:** Not Started

**Value:** Users can capture action items while editing a note — the note editor becomes an active task-capture tool, not just a text area.

**Commands in scope:** `AddActionItem(actionId, noteId, description, addedAt)`
**Events in scope:** `ActionItemAdded { ActionId, NoteId, Description, AddedAt }`
**Projections in scope:** `NoteActions` — per-note view; composite key `(NoteId, ActionId)` in DynamoDB; `IsCompleted: bool` field

**Scenarios:**

```
Scenario: Add an action item to a note
  Given I am viewing a note
  When  I type "Book meeting room" in the action input and submit
  Then  "Book meeting room" appears in the actions list immediately
  And   no page refresh occurs

Scenario: Empty state when no action items exist
  Given I am viewing a note that has no action items
  When  the actions section loads
  Then  I see "No action items yet" and no error

Scenario: Action items persist across navigation
  Given I have added action items to a note
  When  I navigate away and return to the note
  Then  all items are still shown

Scenario: Reject adding an action item to a non-existent note (API)
  Given no note exists with the given noteId
  When  POST /notes/{noteId}/actions with any description
  Then  the response is 404 Not Found

Scenario: Reject duplicate action item (API)
  Given an action item already exists with a given actionId
  When  POST /notes/{noteId}/actions with the same actionId
  Then  the response is 409 Conflict
```

**Acceptance criteria:**

- [ ] *(internal)* Adding an action item to an existing note appends `ActionItemAdded` to the event store under the action's own stream
- [ ] *(internal)* Adding an action item with an `ActionId` that already exists is rejected (duplicate guard)
- [ ] *(internal)* Adding an action item to a non-existent note is rejected (404)
- [ ] User opens a note — an actions section is visible below the content area
- [ ] User types a description and submits — the action item appears in the list immediately, no page refresh
- [ ] User opens a note that has no action items — an empty state ("No action items yet") is shown, not an error
- [ ] User navigates away and reopens the note — the action items are still there
- [ ] E2E: open a note, add two action items, navigate away and back — both items persist

---

## Slice 3-B — Complete and reopen action items on the note screen

**Status:** Not Started

**Value:** Users can tick action items off and undo that tick — the checkbox behaves like a real checkbox.

**Commands in scope:** `CompleteActionItem(actionId, completedAt)`, `ReopenActionItem(actionId, reopenedAt)`
**Events in scope:** `ActionItemCompleted { ActionId, CompletedAt }`, `ActionItemReopened { ActionId, ReopenedAt }`
**Projections in scope:** `NoteActions` — extend to handle `ActionItemCompleted` and `ActionItemReopened`; `IsCompleted` toggled accordingly

**Scenarios:**

```
Scenario: Tick an action item complete
  Given a note has an open action item "Chase invoice"
  When  I tick the checkbox next to "Chase invoice"
  Then  the item is visually marked as complete (checked and struck-through)

Scenario: Untick a completed action item
  Given a note has a completed action item "Chase invoice"
  When  I untick the checkbox next to "Chase invoice"
  Then  the item is shown as open again

Scenario: Completion state persists across navigation
  Given I have ticked an action item complete
  When  I navigate away and return to the note
  Then  the item is still shown as complete

Scenario: Reject completing an already-completed item (API)
  Given an action item is already completed
  When  POST /notes/{noteId}/actions/{actionId}/complete
  Then  the response is 409 Conflict

Scenario: Reject reopening an already-open item (API)
  Given an action item is open
  When  POST /notes/{noteId}/actions/{actionId}/reopen
  Then  the response is 409 Conflict
```

**Acceptance criteria:**

- [ ] *(internal)* Completing an open action item appends `ActionItemCompleted`
- [ ] *(internal)* Completing an already-completed action item is rejected (status guard)
- [ ] *(internal)* Reopening a completed action item appends `ActionItemReopened`
- [ ] *(internal)* Reopening an already-open action item is rejected (status guard)
- [ ] User ticks an action item — it is visually marked complete (checked, struck-through, or moved to a done section)
- [ ] User unticks a completed action item — it is shown as open again
- [ ] Completion state persists across navigation
- [ ] E2E: open a note, add an action item, tick it complete, navigate away and back — completed state persists; untick it, navigate away and back — open state persists

---

## Slice 3-C — View open todos on the home screen

**Status:** Not Started

**Value:** All open action items from every note appear together on the home screen — the same events that drive the per-note panel, projected into a completely different shape. This is the "power of projections" moment: one event stream, two independent read models.

**Commands in scope:** none (read-side only)
**Events in scope:** `ActionItemAdded`, `ActionItemCompleted`, `ActionItemReopened` (same as 3-A/3-B); `NoteRenamed` and `NoteDeleted` (to keep denormalised note titles fresh and remove orphaned rows)
**Projections in scope:** `TodoList` — cross-note; keyed by `ActionId`; only open items stored; `NoteId` GSI for title-update and delete sweeps

**Scenarios:**

```
Scenario: Todo list is empty on a clean account
  Given no open action items exist across any note
  When  I land on the home screen
  Then  a "To Do" section is visible above the notes list
  And   it shows "Your ToDo list is clear."

Scenario: Open action items from notes appear in the todo list
  Given I have a note with an open action item "Send recap email"
  When  I view the home screen
  Then  "Send recap email" appears in the todo list
  And   it shows the parent note's title next to it

Scenario: Completed items do not appear in the todo list
  Given I have completed an action item
  When  I view the home screen
  Then  the completed item is not shown in the todo list

Scenario: Todo list aggregates items from multiple notes
  Given I have two notes, each with one open action item
  When  I view the home screen
  Then  both action items appear in the todo list, each showing its parent note's title

Scenario: Renaming a note updates the title shown in the todo list
  Given the todo list shows an action item under note title "Q1 Planning"
  When  I rename the note to "Q2 Planning"
  Then  the action item in the todo list shows "Q2 Planning" as its parent note title
```

**Acceptance criteria:**

- [ ] User lands on the home screen — a "To Do" section is visible above the notes list; if no open items exist it shows "Your ToDo list is clear."
- [ ] Open action items from notes appear in the todo list with the parent note's title
- [ ] Completed items do not appear in the todo list
- [ ] The todo list contains items from multiple different notes — cross-note aggregation works
- [ ] User renames a note — the updated title is reflected on that note's items in the todo list
- [ ] E2E: create two notes, add one action item to each — both items appear in the home screen todo list

---

## Slice 3-D — Complete and reopen todos from the home screen

**Status:** Not Started

**Value:** Users can tick off todos without leaving the home screen — the most common action (marking something done) requires zero navigation.

**Commands in scope:** `CompleteActionItem`, `ReopenActionItem` (no new backend — reuses 3-B's endpoints; `TodoList` projection already handles these events from 3-C)
**New backend:** none
**New frontend:** checkbox toggle on home screen todo items

**Scenarios:**

```
Scenario: Complete a todo from the home screen
  Given the home screen shows an open todo "Send recap email"
  When  I tick the checkbox next to it
  Then  "Send recap email" disappears from the todo list immediately

Scenario: Reopen a completed todo from the home screen
  Given I have just completed a todo on the home screen and it has disappeared
  When  I undo the completion (e.g. immediate undo action or navigating to the note and unticking)
  Then  the item reappears in the todo list

Scenario: Completing from home screen is reflected in the note
  Given I have completed a todo from the home screen
  When  I open the parent note
  Then  the action item is shown as complete
```

**Acceptance criteria:**

- [ ] User ticks a todo on the home screen — it disappears from the list immediately
- [ ] The completion is reflected when the parent note is opened
- [ ] E2E: add an action item in a note, return to home, tick the todo — it disappears; open the note — the item is shown complete

---

## Slice 3-E — Delete an action item

**Status:** Not Started

**Value:** Users can remove action items they no longer need — keeps the actions list clean.

**Commands in scope:** `DeleteActionItem(actionId, deletedAt)`
**Events in scope:** `ActionItemDeleted { ActionId, DeletedAt }`
**Projections in scope:** `NoteActions` and `TodoList` — both handle `ActionItemDeleted` by removing the row

**Scenarios:**

```
Scenario: Delete an action item from the note screen
  Given a note has an action item "Old task"
  When  I click the delete button next to "Old task" and confirm
  Then  "Old task" is removed from the actions list immediately

Scenario: Deleted item is also removed from the home screen todo list
  Given "Old task" appears in the home screen todo list
  When  I delete it from the note screen
  Then  "Old task" is no longer in the home screen todo list

Scenario: Reject deleting a non-existent action item (API)
  Given no action item exists with the given actionId
  When  DELETE /notes/{noteId}/actions/{actionId}
  Then  the response is 404 Not Found
```

**Acceptance criteria:**

- [ ] *(internal)* Deleting an action item appends `ActionItemDeleted` to the event store
- [ ] *(internal)* Deleting a non-existent action item returns 404
- [ ] User clicks delete on an action item — it is removed from the note's actions list immediately
- [ ] The deleted item also disappears from the home screen todo list
- [ ] E2E: add an action item, verify it appears in both the note and home screen; delete it — gone from both
