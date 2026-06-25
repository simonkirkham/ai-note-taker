# Phase 37 — Reorder the home To Do list (drag-and-drop)

**Goal:** Let the user set the order of the home **To Do** list by dragging items (and via keyboard Move up/down), instead of the fixed `AddedAt` order they have today. Scope is the **home page list only** (`TodoSection`), which mixes standalone to-dos and note-derived action items; per-note action ordering is explicitly out of scope. Ordering is per-workspace and persisted as an event-sourced, RYW-correct read model.

## Summary

| Slice | Summary | Status | Depends on |
| --- | --- | --- | --- |
| 37-A | Drag-and-drop + keyboard reorder of the home To Do open-items list, persisted per workspace via a new `TodoListReordered` event; optimistic UI, async-projector + RYW correct | Not Started | — |

Single thin vertical slice. Breaker layer-splits the implementation: **pass 1** domain + projection + endpoint + store (BDD/API/EventStore.Integration green), **pass 2** frontend DnD + optimistic UI + E2E.

## Design

**Why a dedicated ordering stream, not a `Position` on each item.** The home list interleaves two aggregates (`Todo`, `ActionItem`). Putting position on either would (a) require touching two aggregates and (b) leak ordering into the per-note action view, which must stay `AddedAt`-sorted. Instead, ordering is a **list-level** concern: a per-workspace stream records the explicit order of item ids, and the projection applies it as a sort key over whatever items exist. Item aggregates are untouched (additive, no event versioning).

| Concern | Decision |
| --- | --- |
| Stream | `todo-order#<workspaceId>` — one ordering stream per workspace |
| Aggregate | `TodoOrdering` — near-stateless; any order of any ids is valid, last-write-wins, only invariant is non-empty ordered list |
| Command | `ReorderTodos(WorkspaceId, IReadOnlyList<string> OrderedItemIds)` |
| Event | `TodoListReordered(WorkspaceId, IReadOnlyList<string> OrderedItemIds, DateTimeOffset ReorderedAt)` — full-order snapshot (home lists are small; idempotent; client already holds the reordered array) |
| Position model | Snapshot index → `Position` (nullable int) on `TodoItem`. Items absent from the latest snapshot get `Position = null` |
| Sort | `OrderBy(Position ?? int.MaxValue).ThenBy(AddedAt)` — manually-ordered items first, newly-added (unpositioned) items append by `AddedAt` |
| Scope of snapshot | **Open** items only; Done items are not reordered |
| Read path | Async projector folds `TodoListReordered`, sets per-item `Position` in the `TodoList` projection; endpoint returns the order-stream write version as the consistency token; `GET /todos` gates on it (RYW) |
| Authorization | None against the projection — reorder just records an id ordering; stale/unknown ids match no item and are ignored on sort (avoids the BUG-30 async-projection-auth trap) |
| Endpoint | `POST /w/{workspaceId}/todos/reorder` body `{ orderedItemIds: string[] }` → returns `{ consistencyToken }` |

**Keyboard accessibility (do not regress the CHANGE-15 jsx-a11y gate).** Native HTML5 drag (the existing `FolderTree`/`NoteCard` pattern) is pointer-only. Pair it with per-item **Move up / Move down** icon buttons (`aria-label`) so reordering is fully keyboard-operable; both affordances fire the same reorder mutation. No new DnD dependency — reuse the native `draggable`/`onDragStart`/`onDragOver`/`onDrop` pattern already in `FolderTree.tsx`.

## 37-A — Reorder the home To Do list

### Domain (TodoOrdering aggregate)

- **Reorder records the order** — Given workspace `w1`, When `ReorderTodos(w1, [b, a, c])`, Then a `TodoListReordered(w1, [b, a, c], now)` event is emitted.
- **Empty order rejected** — Given workspace `w1`, When `ReorderTodos(w1, [])`, Then `ArgumentException` (nothing to order).
- **Re-reorder is last-write-wins** — Given a prior `TodoListReordered(w1, [a, b])`, When `ReorderTodos(w1, [b, a])`, Then a new `TodoListReordered(w1, [b, a], now)` event is emitted (no invariant blocks it).

### Projection (TodoListProjection + TodoList read model)

- **Snapshot sets position** — Given todos `a, b, c` (AddedAt a<b<c) in `w1`, When `TodoListReordered(w1, [c, a, b])` is folded, Then `GET /w1/todos` returns open items ordered `c, a, b`.
- **Unpositioned item appends by AddedAt** — Given the order `[c, a]` applied and a new todo `d` added afterwards, Then the list is `c, a, b, d` (b and d unpositioned → after positioned, by AddedAt).
- **Ordering is per-workspace** — Given `TodoListReordered(w1, …)`, Then items in `w2` keep `AddedAt` order (unaffected).
- **`TodoListProjection` folds the snapshot** — the in-memory fold sets `Position` (unit-covered). Note: the whole `TodoList` read model is **projector-maintained only** — it is not wired into `ProjectionRebuildHandler` today (a pre-existing gap, not introduced here), so there is no rebuild path to re-derive `Position`; logged as a technical-improvement.

### API + store

- **Endpoint reorders** — Given authenticated user in `w1`, When `POST /w1/todos/reorder {orderedItemIds:[c,a,b]}`, Then 200 with a `consistencyToken`, and a subsequent token-gated `GET /w1/todos` returns `c, a, b`.
- **Position round-trips in DynamoDB** — `EventStore.Integration`: set `Position` → `PutAsync` → `GetAsync` → assert it survived (the in-memory double cannot catch a missing Dynamo attribute mapping — see CLAUDE.md guardrail; map `Position` in **both** `DynamoDbTodoListStore` write + read **and** the in-memory store sort).

### Frontend (TodoSection)

- **Drag reorders optimistically** — Given the open list `a, b, c`, When the user drags `c` above `a`, Then the list shows `c, a, b` immediately (before the API responds) and a `POST …/todos/reorder` fires.
- **Keyboard reorders** — Given focus on item `c`'s "Move up" button, When activated twice, Then `c` moves to the top; the same mutation fires.
- **Reconcile on error** — Given the reorder request fails, Then the list rolls back to `a, b, c` and an error is surfaced.
- **RYW after reorder** — Given the reorder succeeds, When the cache refetches `GET /todos`, Then the token-gated read returns the new order (no flicker back to `AddedAt`).
- **Done items not draggable** — the Done (today) section has no drag handles / Move buttons.

### Acceptance criteria

1. New `TodoListReordered` event is additive; no existing event shape changes; `EventDeserializer` adds an explicit arm at version 1.
2. `Position` mapped in `DynamoDbTodoListStore` (write + read) **and** the in-memory store, with a DynamoDB-Local round-trip test.
3. Open-items sort is `Position ?? int.MaxValue, then AddedAt` in **both** the prod store read and the in-memory projection.
4. Reorder is optimistic (immediate reflect, reconcile on error) — mandatory per CLAUDE.md.
5. Keyboard reordering works (Move up/down buttons, `aria-label`); `npm run lint` jsx-a11y gate stays green.
6. `GET /todos` reads-your-writes after a reorder via the order-stream consistency token.
7. Reorder records ordering only; no authorization read against the async projection.
8. Event added to `docs/event-model.md`; wire shape to `docs/event-schemas.md`; the `Position` view field to `docs/view-schemas.md`.
9. Deploy-time impact: **neutral** — no new table (`TodoListReordered` rides the existing event stream; `Position` is a new attribute on the existing `TodoList` table). **No projection backfill** — existing items have `Position = null` (sort by `AddedAt`) until first reordered.

## Observability

| Silent failure | Make it visible |
| --- | --- |
| Reorder event written but projector never applies `Position` (list silently stays `AddedAt`) | Structured log on `TodoListReordered` fold: `workspaceId`, item count; metric `TodoReorderApplied` |
| Stale/unknown ids in a snapshot (client/projection drift) | Log count of snapshot ids that matched no item in the workspace |
| RYW gate never catches up (reorder appears lost) | Existing proj-position lag metric covers the order stream; no new alarm for a single-user app |

**Raised in:** future-features "Drag-and-drop to reorder to-do / action items" (2026-06-25); graduated to Phase 37, scoped to the home To Do list only (2026-06-25).
