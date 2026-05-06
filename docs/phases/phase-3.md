# Phase 3 — Cross-aggregate projection (todo list)

**Goal:** Introduce the `ActionItem` aggregate and demonstrate the defining power of event-sourced projections: the same stream of events feeds two completely different read models — a per-note actions panel and a cross-note todo list. By the end of this phase the user can add and complete action items inside a note, and see all open items from every note in a single list on the home screen.

**Scope note:** Phase 3 covers two commands (`AddActionItem`, `CompleteActionItem`) and two events (`ActionItemAdded`, `ActionItemCompleted`). Reopen, edit, and remove are deliberately deferred — the learning surface is the projection demonstration, not the full action-item lifecycle. Three slices are used on purpose: 3-A establishes the aggregate, 3-B wires the per-note view, and 3-C adds the cross-note view over the *same* events. The contrast between 3-B and 3-C is the lesson.

**Dependencies and risks:**
- `ActionId` needs a strongly-typed value wrapper (like `NoteId`) — add it in `src/Domain/` at the start of 3-A.
- The `TodoList` handler for `ActionItemAdded` reads the parent note's title from the `NoteDetail` projection at write time (to denormalise it into the row). This is a cross-projection read at the projection layer — acceptable per `view-schemas.md` principles, but it means `NoteDetail` must be populated before a `TodoList` rebuild is meaningful. Flag in the implementation.
- `NoteActions` uses a composite DynamoDB key `(NoteId, ActionId)` — the CDK stack needs a new table with both PK and SK.
- `TodoList` uses `ActionId` as PK only — a single-key table, but needs a `NoteId` GSI for the `NoteRenamed` / `NoteDeleted` update sweep.

Status key: `Done` · `In Progress` · `Not Started`

---

## Slice 3-A — ActionItem aggregate

**Status:** Not Started

**Value:** The `ActionItem` aggregate comes to life as the system's second aggregate — establishing that the event store can hold multiple independent entity types and laying the foundation for the two projection slices that follow.

*Note: backend-only slice. No UI change — action item events have no user-visible effect until 3-B wires the actions panel. Acceptance criteria confirm aggregate invariants and API contracts.*

**Commands in scope:** `AddActionItem(actionId, noteId, description, addedAt)`, `CompleteActionItem(actionId, completedAt)`
**Events in scope:** `ActionItemAdded { ActionId, NoteId, Description, AddedAt }`, `ActionItemCompleted { ActionId, CompletedAt }`

**Acceptance criteria:**

- [ ] *(internal)* Adding an action item to an existing note appends `ActionItemAdded` to the event store under the action's own stream
- [ ] *(internal)* Adding an action item with a `ActionId` that already exists is rejected (duplicate guard)
- [ ] *(internal)* Completing an open action item appends `ActionItemCompleted`
- [ ] *(internal)* Completing an already-completed action item is rejected (status guard)
- [ ] API: `POST /notes/{noteId}/actions` with a description returns 201 and the new `actionId`
- [ ] API: `POST /notes/{noteId}/actions/{actionId}/complete` returns 200

---

## Slice 3-B — Per-note actions panel

**Status:** Not Started

**Value:** Users can capture action items while editing a note and tick them off when done — the note editor becomes an active task-capture tool, not just a text area.

**Commands in scope:** `AddActionItem`, `CompleteActionItem`
**Events in scope:** `ActionItemAdded`, `ActionItemCompleted`
**Projections in scope:** `NoteActions` — per-note view; composite key `(NoteId, ActionId)` in DynamoDB

**Acceptance criteria:**

- [ ] User opens a note — an actions section is visible below the content area
- [ ] User types a description and submits — the action item appears in the list immediately, no page refresh
- [ ] User ticks an action item — it is visually marked complete (checked, struck-through, or moved to a done section)
- [ ] User navigates away and reopens the note — the action items are still there with their completion state intact
- [ ] User opens a note that has no action items — an empty state ("No action items yet") is shown, not an error
- [ ] E2E: open a note, add an action item, tick it complete, navigate away and back — both the item and its completed state persist

---

## Slice 3-C — TodoList projection (cross-note)

**Status:** Not Started

**Value:** All open action items from every note appear together on the home screen — the same two events that drive the per-note panel, projected into a completely different shape. This is the "power of projections" moment: one event stream, two independent read models.

**Commands in scope:** none (read-side only)
**Events in scope:** `ActionItemAdded`, `ActionItemCompleted` (same as 3-B); `NoteRenamed` and `NoteDeleted` (to keep denormalised note titles fresh and remove orphaned rows)
**Projections in scope:** `TodoList` — cross-note; keyed by `ActionId`; only open items stored; `NoteId` GSI for title-update and delete sweeps

**Acceptance criteria:**

- [ ] User lands on the home screen — a "To Do" section is visible above the notes list; if no open items exist it shows "Your ToDo list is clear."
- [ ] User opens a note and adds an action item — the item appears in the home screen todo list (showing the parent note's title) without a page refresh
- [ ] User ticks an action item complete (from within the note) — the item is gone from the home screen todo list on next visit
- [ ] The todo list contains items from multiple different notes — the cross-note aggregation works
- [ ] User renames a note — the updated title is reflected on that note's items in the todo list
- [ ] E2E: create two notes, add one action item to each, verify both items appear in the home screen todo list; complete one — only the remaining open item is shown
