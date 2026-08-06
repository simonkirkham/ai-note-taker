# Phase 50 — The Today line in the To Do list _(In Progress — 50-A implemented, PR #423 awaiting CI)_

**Goal:** Draw a line anywhere in your To Do list to mark where "today" ends, so the top of the list is what you're actually doing now and everything below it waits its turn.

## Summary

| Slice | What the user gets | Status | Depends on |
|-------|--------------------|--------|------------|
| 50-A | A movable "Today" line in the To Do list that splits it into what's for today and what's for later, and stays where you put it | In Progress | — |
| 50-B | One-click "Move to Today" / "Move to Later" on a to-do, so an item crosses the line without dragging | Not Started | 50-A |

50-A proves the whole flow — draw the line, it persists, the list reads as two groups. 50-B is the convenience layer on top and is worthless without it.

## Slices

<!-- REVIEW SURFACE — the human reads this and stops. No technical artefact named below. -->

### Slice 50-A — Draw and move the Today line

- **User value:** The To Do list is one long undifferentiated list, so "what am I doing right now" is invisible. The line makes the user's own priority call explicit and visible every time they open the app.
- **How it works:**
  - The line is **the user's arbitrary call** — nothing about it is derived from dates, due dates, or when a to-do was created. Where they put it *is* the definition of today.
  - The open To Do list shows a horizontal divider labelled **Today**. Items above it sit under "Today"; items below sit under "Later".
  - The user drags the line up or down to any position in the list, exactly as they already drag a to-do.
  - The line's position sticks — it is still where they left it after a reload, and on any device.
  - Dragging a to-do across the line moves it between Today and Later; the existing drag-to-reorder behaviour is otherwise unchanged.
  - The move is **optimistic** — the line and the two groups re-render on release, before the save confirms.
  - A new to-do captured from the quick-add box lands at the top of the list, so it lands in Today.
  - Completing an item does not move the line.
- **Scenarios (GWT):**

```
Scenario: The line splits the list into Today and Later
  Given an open To Do list with five items and the Today line after the second
  When  the user looks at the list
  Then  the first two items appear under "Today"
  And   the remaining three appear under "Later"

Scenario: Moving the line changes what counts as today
  Given the Today line sits after the second item
  When  the user drags the line down below the fourth item
  Then  four items appear under "Today"
  And   the list re-renders immediately, before the save completes

Scenario: The line's position survives a reload
  Given the user has placed the Today line after the third item
  When  they reload the app
  Then  the Today line is still after the third item

Scenario: Dragging a to-do across the line moves it between the groups
  Given an item sits under "Later"
  When  the user drags it above the Today line
  Then  it appears under "Today"
  And   it stays there after a reload

Scenario: A newly captured to-do lands in Today
  Given the Today line sits after the second of five items
  When  the user adds a to-do from the quick-add box
  Then  the new item appears at the top of the list, under "Today"

Scenario: Everything is today
  Given the Today line sits below every item
  When  the user looks at the list
  Then  every item appears under "Today"
  And   no empty "Later" group is shown

Scenario: Nothing is today
  Given the Today line sits above every item
  When  the user looks at the list
  Then  every item appears under "Later"
  And   the "Today" group shows an empty-state line rather than nothing at all

Scenario: An empty list
  Given there are no open to-dos
  When  the user looks at the list
  Then  no Today line is shown

Scenario: Completing the item just above the line does not move the line
  Given the Today line sits directly below a single Today item
  When  the user completes that item
  Then  the item leaves the open list
  And   the Today line stays in the same place relative to the remaining items
```

### Slice 50-B — Move a to-do across the line in one click

- **User value:** Promoting something into today (or pushing it out) is the most common reason to touch this list; a drag across a long list is slow and, since the reorder arrows were removed, there is no keyboard path at all.
- **How it works:**
  - Each open to-do row offers a single action whose label reflects which side it is on: **Move to Today** for an item under "Later", **Move to Later** for an item under "Today".
  - Moving to Today places the item at the **bottom of the Today group** (directly above the line), not the top — it does not jump ahead of what the user already prioritised.
  - Moving to Later places the item at the **top of the Later group** (directly below the line).
  - The action is keyboard-reachable, restoring a keyboard reorder path.
  - The move is optimistic and the list re-renders immediately.
- **Scenarios (GWT):**

```
Scenario: Promote an item into today
  Given an item sits under "Later"
  When  the user chooses "Move to Today" on that item
  Then  it appears as the last item under "Today"
  And   the Today line has not moved relative to the other items

Scenario: Push an item out of today
  Given an item sits under "Today"
  When  the user chooses "Move to Later" on that item
  Then  it appears as the first item under "Later"

Scenario: The action reflects which side the item is on
  Given one item under "Today" and one under "Later"
  When  the user inspects each row's action
  Then  the Today item offers "Move to Later"
  And   the Later item offers "Move to Today"

Scenario: The move is reachable by keyboard
  Given an item under "Later" is focused
  When  the user activates its move action with the keyboard
  Then  the item moves under "Today" without a pointer being used
```

---

## Build notes _(implementation — skip when reviewing)_

### 50-A
- **Surface:** `web/src/components/TodoSection.tsx` — the existing open-items list (`openItems`, ordered by `TodoItem.Position`), drag handled by `handleDrop` → `reorderTo(arrayMove(...))` → `useReorderTodos`.
- **Events/commands:** additive **new event type on the existing `TodoOrdering` aggregate** (`src/Domain/Todos/`, stream `todo-order#{workspaceId}`) — e.g. `SetTodayLine` → `TodayLineSet(WorkspaceId, AnchorItemId?, SetAt)`. A *new* event type, **not** a v2 of `TodoListReordered`, so no event versioning is needed and the existing full-order snapshot semantics are untouched.
- **Anchoring — DECIDED: anchor to an item id** (line sits immediately **above** `AnchorItemId`; `null` = below everything), over storing an index, which every add/remove/complete would shift and silently drift. Implemented as `TodayLineSet(WorkspaceId, AnchorItemId?, SetAt)`.
- **Anchor-lost rule — DECIDED: relocate DURABLY in the projector, not on read.** Resolving a completed/deleted anchor at read time was tried first and is not sufficient: a completed anchor **ages out of the read window after ~2 days** and a deleted one is gone at once, and in both cases the read then silently drops the line to the bottom (everything becomes Today) with no way back — exactly the silent failure the Observability section below flags. So `ProjectionUpdater` relocates the anchor to the next still-open item the moment it stops being open (`TodoCompleted`, `TodoDeleted`, `ActionItemCompleted`, `ActionItemDeleted`, and note deletion's action-item cascade). The read-side resolution is kept, but now only covers the transient window before the projector write lands.
- **Keying — DECIDED: per USER **and** per workspace.** A workspace-only key let two users overwrite each other's line, because a rootless request resolves to the shared `__default__` workspace. `SetTodayLineAsync`/`GetTodayLineAnchorAsync` take `userId` as well; `TodayLineSet` reads the user off the envelope metadata and is skipped (logged `Warning`) if absent. `null` anchor **deletes** the row rather than `REMOVE`-ing the attribute, so no key-only row is left behind.
- **Client re-anchor on delete.** Deleting the anchor is the same hazard client-side: the optimistic cache update removes the row, `findIndex` returns `-1`, `splitAt` becomes `openItems.length`, and the line visibly drops to the bottom until a refetch lands. The projector relocation is eventually consistent so it cannot prevent that flash. `handleDelete` therefore steps the line down first (mirroring the existing drag path's `reanchorIfLineWouldFollow`) — **awaited**, so the stored anchor never points at a deleted row, but **non-fatal**, so a failed line move cannot swallow the delete the user asked for. The projector relocation remains the fallback for deletes from the note Actions panel and other devices, and no-ops when the client write lands first.
- **A11y:** the line is a **focusable ARIA window-splitter**, not a static divider — `role="separator"` + `tabIndex={0}` + `aria-valuenow`/`valuemin`/`valuemax`, moved with the arrow keys. `jsx-a11y/no-noninteractive-element-interactions` and `no-noninteractive-tabindex` both assume `separator` is always non-interactive, so they carry a scoped disable with that justification.
- **Projections:** the line lives on the todo list read model alongside `Position` — either a field on the per-workspace list or a sentinel row in `ITodoListStore`/`TodoListProjection` (`src/EventStore/Projections/`). Fold `TodayLineSet` in `TodoListProjection.Handle` and add the matching `EventDeserializer` arm. Grouping itself is a **frontend** split of the already-ordered list at the anchor — do not build two server-side lists.
- **DynamoDB mapping:** per the `*View` guardrail, map the new field in `DynamoDbTodoListStore` (`UpsertAsync` **and** the row→`TodoItem` map) — the in-memory double keeps it by reference and will pass regardless. Add an `EventStore.Integration` round-trip test (set → `UpsertAsync` → `GetAsync` → survived).
- **API:** a new command route alongside the existing reorder endpoint; emits `X-Consistency-Token` on the `todo-order#` stream and the client captures it (BUG-44/45 class — an ungated refetch after the write will flicker the line back).
- **Stream-collision warning:** `todo-order#{workspaceId}` is a **stable-id** stream (`todo-order#__default__`), which is exactly what bit [BUG-39] — a stale `notetaker-proj-position` mark caused re-appended events to be skipped as duplicates after a test-data clear. Adding a second event type to this stream inherits that fragility; confirm `clear-test-data` still clears `proj-position` before relying on any E2E here.
- **Tests:** Domain spec for `SetTodayLine` (including anchor-removed relocation); `TodoListProjection` fold spec; `Api.Integration` for the route + token header; `TodoSection` vitest for the split rendering, optimistic move, and each edge scenario above.
- **Acceptance criteria:**
  - [x] The open list renders as two labelled groups split at the line. — `splits the list into Today and Later at the line`
  - [x] Dragging the line persists its position across a reload. — `SetTodayLine_PersistsTheAnchor`; the reload half is E2E-only and has not run (see verification note).
  - [x] The split re-renders optimistically, before the save resolves. — `dragging the line down re-splits immediately, before the save completes`
  - [x] A quick-captured to-do lands above the line. — `a newly captured to-do lands at the top of the list, in Today`
  - [x] Completing an item does not relocate the line. — `completing a Today item leaves the line where it was` + `CompletingTheItemAboveTheLine_LeavesTheAnchorAlone`. **Reads as a contradiction with the durable-relocation decision above, and is not one:** completing the *anchor* does change the stored pointer, precisely so the line keeps its **visual** position among the remaining items. The criterion is about the line not jumping for the user, not about the pointer being immutable.
  - [x] All-Today hides the empty "Later" group; all-Later shows a Today empty state. — `an unset line puts everything in today and shows no Later group` + `dragging the line onto the first item leaves nothing in today, with an empty state`
  - [x] The new field round-trips through `DynamoDbTodoListStore` (integration test). — **executed against DynamoDB Local 2026-08-06, all 6 green:** `TodayLine_SurvivesTheRoundTrip`, `TodayLine_IsUnsetWhenNeverWritten`, `TodayLine_IsScopedPerWorkspace`, `TodayLine_IsScopedPerUserNotJustPerWorkspace` (proves the per-user keying decision at the DynamoDB boundary), `TodayLine_ANullAnchorClearsTheStoredValue` (proves the delete-the-row-not-`REMOVE`-the-attribute decision), `TodayLine_MarkerRowIsNotReturnedAsAnItem` (proves the sentinel row does not leak into the item list). Per the `*View` guardrail this is the only suite that can catch a `DynamoDb*Store` mapping gap — the in-memory double keeps the value by reference and would pass regardless.
- **Verification status (2026-08-06, pre-merge):** build clean, 0 warnings; `Domain.Specs` 319/319; `Api.Integration` 701/701; `EventStore.Integration` 36/36 against DynamoDB Local; frontend 860/860 across 86 files; `eslint` clean; `tsc` clean against **both** `tsconfig.json` and `tsconfig.test.json`. Every acceptance criterion now has a named passing test behind it. **Not run:** the deploy-gate E2E only. PR #423 is `MERGEABLE`/`CLEAN` but **no CI run exists for its head sha** — a GitHub Actions `major_outage` on 2026-08-06 meant the push event never created a run, and `pr.yml` has no `workflow_dispatch`, so it needs a fresh `pull_request` event (close/reopen) once runners return.
- **Decisions:** no dates of any kind — no due date, no created date, no derived "today". The line is purely a user-positioned marker in the existing priority order. This **supersedes the due-date design** previously sketched in `docs/future-features.md` under *Expand the to-do functionality for today and the future* (2026-06-02), which assumed `ActionItemDueDateSet`/`TodoScheduled` events and Today/Upcoming/Overdue grouping.

### 50-B
- **Surface:** same rows as [CHANGE-34]'s "Send to top / Send to bottom"; both compute a new full id order and call the same `reorderTo` path. Build after CHANGE-34 lands, or expect a trivial merge in `TodoSection`.
- **Events/commands:** none new — reuses `ReorderTodos` plus 50-A's line anchor. A "Move to Today" is a reorder that places the item immediately above the anchor; "Move to Later" places it immediately below.
- **Tests:** `TodoSection` vitest for placement at the bottom-of-Today / top-of-Later, the label flipping by side, and keyboard activation.
- **Acceptance criteria:**
  - [ ] "Move to Today" lands the item last in Today, not first.
  - [ ] "Move to Later" lands the item first in Later.
  - [ ] The label reflects the item's current side.
  - [ ] The action is operable by keyboard alone.
- **Decisions:** bottom-of-Today (not top) so promoting never jumps the user's existing priority order.

### Observability
- **50-A silent failure:** the line save fails and the UI keeps showing the optimistic position — the user believes it stuck and finds it moved on the next device/reload. Surface the failed mutation to the user rather than only reconciling silently.
- **50-A silent failure:** the anchor item is deleted/completed and the relocation rule mis-fires, silently dropping the line to the bottom (everything becomes Today). Log the relocation with the old and new anchor so it is diagnosable.
- **50-B:** no distinct failure mode — it is a `ReorderTodos` and inherits that command's existing instrumentation (`CommandInstrumentation` in `TodoOrderCommandHandler`).
- Run the `observability-brief` skill against these before Breaker to confirm nothing else is silent.

### Deploy-time
- Backend + frontend → full `cdk deploy`. New event type and a projection **field** — no new table, so no backfill and no new projection to populate. **Neutral**, no recurring per-deploy cost.
