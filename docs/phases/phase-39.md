# Phase 39 — Edit the text of a to-do / action item _(Done)_

**Phase complete — both slices live in prod 2026-06-26.** 39-A (note action items, PR #349 + #354) and 39-B (standalone to-dos, PR #356). 39-B's deploy was held by an unrelated shared-gate failure (the 37-A reorder journey, [BUG-39](phase-bugs.md#bug-39)) — quarantined to unblock, then properly fixed by the 37-A session (a test-env `clear-test-data`/`proj-position` gap, not a product bug).

**Goal:** Let the user **edit the text** of an existing action item (on a note) or standalone home to-do. Today the text is fixed once created — the only operations are complete, reopen, and delete — so a mis-captured or AI-auto-extracted item can only be fixed by delete-and-recreate. This adds in-place text editing. The design is **already in the event model** (`EditActionItem`/`ActionItemEdited` are documented in [event-model.md](../event-model.md) and [event-schemas.md](../event-schemas.md) but were never implemented), and the `Description` field **already exists** on every read view (`NoteAction`, `NoteCardActionItem`, `TodoItem`), so projections need a *fold case*, not a schema change. **No new aggregate, no new table, no projection backfill, no CDK change → deploy-time neutral.** Graduated from the "Rename to-do / action items" item in `future-features.md`.

## Summary

| Slice | Summary | Status | Depends on |
|-------|---------|--------|------------|
| 39-A | **Edit a note action item's text (keystone).** New `EditActionItem`/`ActionItemEdited` (additive); aggregate edit guard (exists & not deleted; reject empty); command handler + `PUT /notes/{noteId}/actions/{actionId}` returning the RYW token; both rebuild projections + the async `ProjectionUpdater` fold the new text into `NoteActions`, the card action-item rollup, the search view, and the `TodoList` action row (via a new `ITodoListStore.UpdateDescriptionAsync`); inline click-to-edit UI in `ActionsSection`, optimistic. Proves the whole flow end-to-end. | Done | — |
| 39-B | **Edit a standalone to-do's text (scale).** Same pattern on the `Todo` aggregate: `EditTodo`/`TodoEdited`, command handler + `PUT /todos/{todoId}`, `ProjectionUpdater` + rebuild fold via the (39-A) `UpdateDescriptionAsync`, inline edit in `TodoSection`, optimistic. | Done | 39-A |

> **39-A is the whole feature end-to-end** on the richer path (3 projection views + the RYW token) and carries the design risk. **39-B reuses the proven event/projection/optimistic-edit pattern** on the simpler Todo path (one projection view). Ship 39-A first; branch 39-B only after 39-A deploys green.

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

---

## Slices

### Slice 39-A — Edit a note action item's text (keystone)

**User value:** Fix a typo or reword a mis-captured / AI-extracted action on a note without deleting and re-adding it.

**Scenarios (GWT):**
- Given an open action item "Chase invoice", when I edit its text to "Chase Acme invoice", then the row immediately shows the new text (optimistic — no wait for save).
- Given a **completed** action item, when I edit its text, then the text changes and its completed state is preserved.
- Given I edited an action item's text and it saved, when I reload the note, then the new text is shown (read-your-writes via the consistency token).
- Given an action item that surfaces on a home card, when I edit its text, then the card's action-item text and search both reflect the edit.
- Given I clear the text to empty/whitespace and confirm, then the edit is rejected (400) and the original text is restored.
- Given an edit to a note I do not own / a missing or deleted action item, then the server responds 404/409 and the row reverts.
- Given keyboard focus on an action row, when I open the inline editor and press Enter (or Esc), then I can save (or cancel) without a pointer.

**Acceptance criteria:**
- New `EditActionItem` command + `ActionItemEdited` event (both with `EditedAt`); `ActionItem.Handle` adds `HandleEdit` (`InvalidOperationException` if `!_exists || _deleted`; `ArgumentException` if empty); no `Apply` change.
- `EventDeserializer` + both rebuild projections (`NoteActionsProjection`, `TodoListProjection`) + the async `ProjectionUpdater` fold `ActionItemEdited`.
- `ActionItemCommandHandler.HandleAsync(EditActionItem)` (+ interface) delegating to `ExecuteAppendAsync`; `PUT /notes/{noteId}/actions/{actionId}` (`EditActionItemRequest(string Description)` — no unused fields) mirroring `CompleteActionItem` (owner→404, empty→400, missing→404, deleted→409, sets `X-Consistency-Token`).
- `ITodoListStore.UpdateDescriptionAsync` on **both** stores (the TodoList view holds action rows too) + a DynamoDB-Local round-trip test.
- Frontend: `editAction`, `useEditAction` (optimistic + rollback), inline click-to-edit in `ActionsSection`. **Optimistic UI mandatory.**
- Tests: `EditActionItemSpec`, `NoteActions`/`TodoList` projection edit cases, Api.Integration `PUT` (200+token / 400 / 404 / 409 / edit-then-complete guard), `EventStore.Integration` round-trip, vitest (`ActionsSection` edit/keyboard/Esc/empty/rollback), Browser.E2E reload-tolerant add→edit→reload.

### Slice 39-B — Edit a standalone to-do's text (scale; depends on 39-A)

**User value:** Same correction for the home-screen quick-capture to-do list.

**Scenarios (GWT):**
- Given an open to-do, when I edit its text, then the row immediately shows the new text (optimistic).
- Given a completed to-do, when I edit its text, then the text changes and its completed state is preserved.
- Given I edited a to-do and it saved, when I reload the home screen, then the new text is shown (read-your-writes).
- Given I clear a to-do's text to empty and confirm, then the edit is rejected and the original text is restored.
- Given an edit to a to-do I do not own / already deleted, then the server responds 404/409 and the row reverts.
- Given keyboard focus on a to-do row, when I edit and press Enter (or Esc), then I can save (or cancel) without a pointer.

**Acceptance criteria:**
- New `EditTodo`/`TodoEdited` (with `EditedAt`); `Todo.Handle` adds `HandleEdit`; `EventDeserializer` + both projection paths fold `TodoEdited` via `UpdateDescriptionAsync` (added in 39-A).
- `TodoCommandHandler.HandleAsync(EditTodo)` (+ interface); `PUT /todos/{todoId:guid}` (`EditTodoRequest(string Description)`) mirroring `AddTodo`'s ownership + token/response handling.
- Frontend: `editTodo`, `useEditTodo` (optimistic + rollback), inline edit in `TodoSection`. **Optimistic UI mandatory.**
- Tests: `EditTodoSpec`, `TodoListProjectionSpec` todo edit case, Api.Integration `PUT /todos/{id}`, vitest (`TodoSection` edit interaction). Run `npm run lint`.

---

## Observability

Run-of-the-mill CRUD edit on an existing aggregate + projection field; the failure modes are the standard mutation ones, already covered by existing telemetry — no new instrumentation warranted (flagged, not added):

- **Primary silent failure — the edit is accepted client-side but never persists** (handler/projector drops it, or a 409/400 is swallowed leaving a stale optimistic value). Guarded by the **mandatory optimistic-rollback acceptance criterion + the Api.Integration status-code tests**, not by instrumentation. The endpoint rides the existing per-request structured logging (TI-38: 409/404 at Warning, 500 once at Error).
- **Edit-then-complete reset** — a real interaction bug found at scoping (the projector reconstructing `NoteAction` from the original description). Guarded by a deterministic Api.Integration test, not telemetry.
- **Read-after-edit lag** — covered by the existing `ConsistencyGate` (the edit returns the RYW token; the gated read waits) and the reload-tolerant E2E.
- **No new backend metric/alarm** — the slice adds no new resource, table, or external call.

## Deploy-time impact

**Neutral.** No CI workflow, CDK, alias/traffic-shifting, or build-step change; no new resource and no projection backfill. Additive event types ride the existing event store and projections.
