# Phase 39 — Edit the text of a to-do / action item _(Done — both slices live 2026-06-26)_

**Goal:** Fix the wording of a to-do or action item in place, instead of deleting it and typing it again.

## Summary

| Slice | What the user gets | Status | Depends on |
|-------|---------|--------|------------|
| 39-A | Reword an action item on a note — including one the AI extracted — without deleting and re-adding it | Done _(#349 + #354)_ | — |
| 39-B | The same correction for a quick-capture to-do on the home screen | Done _(#356)_ | 39-A |

39-A is the whole feature end-to-end on the harder path — an action shows up in three places, so an edit has to reach all of them — and carries the design risk. 39-B then reuses the proven pattern on the simpler home to-do. Ship 39-A first; start 39-B only once it deploys green.

## Slices

### 39-A — Reword an action item on a note

**User value:** fix a typo or reword a mis-captured (or AI-extracted) action without deleting it and typing it again.

**How it works:**
- Click an action's text and it becomes editable in place.
- **Enter** or clicking away saves; **Esc** cancels — all reachable from the keyboard alone.
- The new text appears the instant you save, before the server confirms.
- Completed actions are editable too, and stay completed.
- Clearing the text to nothing is refused and the original comes back.
- The edit follows the action everywhere it appears — the note, the home card, and search.

**Scenarios (GWT):**
```
Scenario: Reword an open action
  Given an open action "Chase invoice"
  When  I edit its text to "Chase Acme invoice"
  Then  the row shows the new text immediately, without waiting for the save

Scenario: Reword a completed action
  Given a completed action
  When  I edit its text
  Then  the text changes and it is still completed

Scenario: The edit survives a reload
  Given I edited an action's text and it saved
  When  I reload the note
  Then  the new text is shown

Scenario: The edit follows the action everywhere
  Given an action that also appears on a home card
  When  I edit its text
  Then  the home card and search both show the new text

Scenario: Emptying the text is refused
  Given I clear an action's text to nothing and confirm
  Then  the edit is refused and the original text comes back

Scenario: Editing something that is not mine, or is gone
  Given an action on a note I do not own, or one already deleted
  When  I try to edit it
  Then  the edit is refused and the row reverts

Scenario: Keyboard only
  Given keyboard focus on an action row
  When  I open the inline editor and press Enter, or Esc
  Then  I can save, or cancel, without touching a pointer
```

### 39-B — Reword a to-do on the home screen

**User value:** the same correction for a quick-capture to-do, which is where most typos land.

**How it works:**
- Identical interaction to 39-A: click to edit, Enter/blur saves, Esc cancels, keyboard-reachable, optimistic.
- Completed to-dos are editable and stay completed; empty text is refused.

**Scenarios (GWT):**
```
Scenario: Reword an open to-do
  Given an open to-do
  When  I edit its text
  Then  the row shows the new text immediately

Scenario: Reword a completed to-do
  Given a completed to-do
  When  I edit its text
  Then  the text changes and it is still completed

Scenario: The edit survives a reload
  Given I edited a to-do and it saved
  When  I reload the home screen
  Then  the new text is shown

Scenario: Emptying the text is refused
  Given I clear a to-do's text to nothing and confirm
  Then  the edit is refused and the original text comes back

Scenario: Editing something that is not mine, or is gone
  Given a to-do I do not own, or one already deleted
  When  I try to edit it
  Then  the edit is refused and the row reverts

Scenario: Keyboard only
  Given keyboard focus on a to-do row
  When  I edit and press Enter, or Esc
  Then  I can save, or cancel, without touching a pointer
```

---

## Build notes _(implementation — skip when reviewing)_

The design was **already in the event model** (`EditActionItem`/`ActionItemEdited` documented in [event-model.md](../event-model.md) and [event-schemas.md](../event-schemas.md) but never implemented), and the `Description` field **already exists** on every read view (`NoteAction`, `NoteCardActionItem`, `TodoItem`) — so the projections need a *fold case*, not a schema change. No new aggregate, no new table, no projection backfill, no CDK change. Graduated from the "Rename to-do / action items" item in `future-features.md`.

**Learning surface:** completing a documented-but-unimplemented command; a purely additive event that mutates only a projection's existing field (no schema/table change); keeping an optimistic inline edit honest under the async projector + RYW consistency token.

**39-A done — live in prod 2026-06-25 (PR #349 + fast-follow #354).** Hawk caught two missing rebuild-projection folds pre-merge (`NoteCardList`/`NoteSearchView` — rebuild ≠ async). The first deploy then **failed the E2E gate deterministically**: `ActionEditJourney` edited the action while the optimistic add still held a `temp-…` id (the onSettled refetch hadn't swapped it), so the edit `PUT` hit `/actions/temp-…` → 404 → silent rollback. Vitest/Api.Integration never exercised this (they seed a real id); only the slow deploy env surfaced it. Fixed in #354 by reconciling through a gated reload before editing (the "don't act on optimistic state" E2E guardrail). A concurrent unrelated `TagsJourney` cold-start flake on the same run is [BUG-38](phase-bugs.md#bug-38). See the learnings doc.

**Decisions locked at scoping (2026-06-25):**
- **One new event + command per aggregate, purely additive** — existing events untouched. `EditActionItem(ActionId, NewDescription, EditedAt)` → `ActionItemEdited(ActionId, NewDescription, EditedAt)`; `EditTodo(TodoId, NewDescription, EditedAt)` → `TodoEdited(TodoId, NewDescription, EditedAt)`. `EditedAt` matches the **implemented** sibling events (`ActionItemCompleted`/`Deleted` carry a timestamp).
- **Preconditions:** item exists and is **not deleted** — editable whether **open or completed**. **Empty/whitespace text rejected** (mirror `Todo.HandleAdd`'s `string.IsNullOrWhiteSpace` guard → `ArgumentException` → 400). The aggregate tracks only `_exists/_completed/_deleted` (not the text), so no same-text comparison — guard empty, else emit.
- **`EventDeserializer`:** add a **wildcard** arm per new type (`(nameof(ActionItemEdited), _) => …`). The narrow-the-arm guardrail does *not* apply — these are brand-new event *types* with no history.
- **Edit UX:** click the description → it becomes an inline `<input>`; **Enter / blur saves, Esc cancels** (mirrors `FolderTree`'s inline rename). Keyboard-accessible (real `<button>`/`<input>`; `autoFocus` with the justified scoped jsx-a11y disable, as FolderTree). **Optimistic update mandatory.**
- **RYW:** both action and todo reads are token-gated (actions RYW-3a, todos RYW-1). The edit handler/endpoint **mirrors the sibling command's exact token/response handling** (`CompleteActionItem` for actions; `AddTodo` for todos); E2E asserts reload-tolerantly.
- **No new projection, no backfill.** Historical items keep their original text; editing only affects items edited after deploy.
- **Edit-then-complete interaction:** the async `ProjectionUpdater` reconstructs the `NoteAction` row wholesale on each state change, so it now carries the **current** description (latest `ActionItemEdited`, else the original) — using `ActionItemAdded.Description` there would reset an edit on a subsequent complete/reopen. Guarded by an Api.Integration test.

**Learning surface:** completing a documented-but-unimplemented command; a purely additive event that mutates only a projection's existing field (no schema/table change); keeping an optimistic inline-edit honest under the async projector + RYW consistency token.

### Slice 39-A — Edit a note action item's text (keystone)

**Acceptance criteria:**
- New `EditActionItem` command + `ActionItemEdited` event (both with `EditedAt`); `ActionItem.Handle` adds `HandleEdit` (`InvalidOperationException` if `!_exists || _deleted`; `ArgumentException` if empty); no `Apply` change.
- `EventDeserializer` + both rebuild projections (`NoteActionsProjection`, `TodoListProjection`) + the async `ProjectionUpdater` fold `ActionItemEdited`.
- `ActionItemCommandHandler.HandleAsync(EditActionItem)` (+ interface) delegating to `ExecuteAppendAsync`; `PUT /notes/{noteId}/actions/{actionId}` (`EditActionItemRequest(string Description)` — no unused fields) mirroring `CompleteActionItem` (owner→404, empty→400, missing→404, deleted→409, sets `X-Consistency-Token`).
- `ITodoListStore.UpdateDescriptionAsync` on **both** stores (the TodoList view holds action rows too) + a DynamoDB-Local round-trip test.
- Frontend: `editAction`, `useEditAction` (optimistic + rollback), inline click-to-edit in `ActionsSection`. **Optimistic UI mandatory.**
- Tests: `EditActionItemSpec`, `NoteActions`/`TodoList` projection edit cases, Api.Integration `PUT` (200+token / 400 / 404 / 409 / edit-then-complete guard), `EventStore.Integration` round-trip, vitest (`ActionsSection` edit/keyboard/Esc/empty/rollback), Browser.E2E reload-tolerant add→edit→reload.

### Slice 39-B — Edit a standalone to-do's text (scale)

**Acceptance criteria:**
- New `EditTodo`/`TodoEdited` (with `EditedAt`); `Todo.Handle` adds `HandleEdit`; `EventDeserializer` + both projection paths fold `TodoEdited` via `UpdateDescriptionAsync` (added in 39-A).
- `TodoCommandHandler.HandleAsync(EditTodo)` (+ interface); `PUT /todos/{todoId:guid}` (`EditTodoRequest(string Description)`) mirroring `AddTodo`'s ownership + token/response handling.
- Frontend: `editTodo`, `useEditTodo` (optimistic + rollback), inline edit in `TodoSection`. **Optimistic UI mandatory.**
- Tests: `EditTodoSpec`, `TodoListProjectionSpec` todo edit case, Api.Integration `PUT /todos/{id}`, vitest (`TodoSection` edit interaction). Run `npm run lint`.

### Observability

Run-of-the-mill CRUD edit on an existing aggregate + projection field; the failure modes are the standard mutation ones, already covered by existing telemetry — no new instrumentation warranted (flagged, not added):

- **Primary silent failure — the edit is accepted client-side but never persists** (handler/projector drops it, or a 409/400 is swallowed leaving a stale optimistic value). Guarded by the **mandatory optimistic-rollback acceptance criterion + the Api.Integration status-code tests**, not by instrumentation. The endpoint rides the existing per-request structured logging (TI-38: 409/404 at Warning, 500 once at Error).
- **Edit-then-complete reset** — a real interaction bug found at scoping (the projector reconstructing `NoteAction` from the original description). Guarded by a deterministic Api.Integration test, not telemetry.
- **Read-after-edit lag** — covered by the existing `ConsistencyGate` (the edit returns the RYW token; the gated read waits) and the reload-tolerant E2E.
- **No new backend metric/alarm** — the slice adds no new resource, table, or external call.

### Deploy-time impact

**Neutral.** No CI workflow, CDK, alias/traffic-shifting, or build-step change; no new resource and no projection backfill. Additive event types ride the existing event store and projections.
