# Phase 20-D — Actions + tag-index TanStack Query migration

Two component-scoped domains (no `App.tsx`). PR #191. Builds on [[phase-20a-tanstack-foundation-todos]] and [[phase-20b-folders]].

## Keystone principle on a per-note key with a cross-domain consumer

`keys.actions(noteId)` has exactly **one** query consumer (`ActionsSection`) — but actions also surface in the home to-do list under a *different* key (`keys.todos`, 20-A). So:

| Mutation | Invalidates | Why |
|---|---|---|
| complete / reopen / delete | `keys.todos` only | `keys.actions(noteId)` is single-consumer and optimistic == server → self-invalidate is pure churn. The home to-do list is the *other* consumer, under its own key. |
| add | `keys.actions(noteId)` **and** `keys.todos` | add also needs the temp-id→real-id swap, which only a refetch of `keys.actions` knows. |

The rule generalises: **invalidate the keys of *other* views that read the same underlying data, not your own key — unless you need server-assigned fields (ids) back.** Don't reflexively self-invalidate every mutation.

## Bidirectional cross-view loops must be cycle-free

Actions↔todos sync runs both ways: action mutations invalidate `keys.todos`; the 20-A todo mutations now invalidate `keys.actions(item.noteId)` for `type:"action"` items (`settleAction`). This is safe because **invalidation triggers query *refetches*, never mutation `onSettled`** — so the two directions can't ping-pong. When wiring A→B and B→A invalidation, confirm neither side's invalidate re-fires the other's *mutation* (it won't, as long as you invalidate query keys, not call mutations).

## Migrating can *fix* an optimistic-UI violation

`ActionsSection` was secretly **pessimistic** — it updated state *after* the `await`, so the checkbox/row only changed once the server replied. The `useMutation` `onMutate` migration made it properly optimistic (apply-then-reconcile), bringing it into line with the CLAUDE.md optimistic-UI rule. Audit hand-rolled handlers for "setState after await" when migrating — the move to `onMutate` is the moment to correct it.

## Boundary: index vs applied tags

Two different things named "tags": the **global tag index** (`keys.tags` — counts, note ids; read by `NoteView` suggestions and the `ListView` home filter) and a note's **applied tags** (`NoteView`'s local `tags`). 20-D migrated only the index (one shared `useTags()` replacing two `getTags()` effects). Applied tags are note-detail state → 20-E. The tag mutations invalidate the index on settle; `NoteView` keeps applied-tags optimism local and now reverts it on error (upgrading the old silent `.catch(() => {})`).

## Test gotchas (Hawk-caught)

1. **A test must prove the spec's failure path, not just the happy end-state.** The add test asserted only `getByText('Book meeting')` — which the optimistic row satisfies *regardless* of the temp-id swap. Assert the **real-id** test id (`action-description-new-1`) appears AND the `temp-` row is gone. And add a forced-reject test per mutation (the observability mandate), not just success tests.
2. **`getTodos` returns `body.items`, not `body.todos`.** A cross-view test handler returning `{ todos: [...] }` made the query resolve `undefined` → "Query data cannot be undefined". Match the API's real unwrap shape in MSW handlers.
3. Distinct aria-labels let one render host two views of the same item unambiguously: TodoSection's checkbox is `Complete "X"`, ActionsSection's is `Mark "X" complete` — so a cross-view test can target each precisely.
