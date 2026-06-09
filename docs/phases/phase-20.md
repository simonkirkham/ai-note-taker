# Phase 20 — Server-state migration to TanStack Query

**Goal:** Replace the hand-rolled `useEffect`-fetch + `useState` server-state hooks with **TanStack Query** — normalised query cache, request dedup, retry/backoff, stale-while-revalidate, and built-in optimistic-update-with-rollback — migrating **incrementally, one domain per slice**, with hand-rolled and TanStack coexisting until the last slice. This **reverses [ADR 0010](../adr/0010-server-state-strategy.md)** (Accepted: *stay hand-rolled*), so it is **hard-gated** on a superseding ADR. Builds on the clean `api/<domain>.ts` seam from slice 19-A.

## Summary

| Slice | Summary | Status | Depends on |
|-------|---------|--------|------------|
| Gate | **Supersede ADR 0010** with a new ADR recording the trigger that justifies reversal. No code. | Done | — |
| 20-A | **Foundation + todos pilot.** `QueryClientProvider`, query-key factory, `QueryClient` defaults, devtools; migrate `TodoSection` (`getTodos` + complete/reopen/delete/add) as the reference template for every later slice. | Done | Gate |
| 20-B | **Folders (tree).** `getFolders` + create/rename/delete/move-folder; delete the `App.tsx` `getFolders().then(setFolders)` invalidation sprawl. Note↔folder assignment (`moveNoteToFolder`/`unfileNote`) defers to 20-C with note cards. | Done | 20-A |
| 20-C | **Note cards / list.** Unify `App.tsx`'s `cards` state + `useNotes().notes` into one `useNoteCards()` query; note CRUD + move-to-folder/unfile mutations; delete-folder invalidates `keys.noteCards`. Delete `useNotes`. (Tag→card-pill refresh is via `handleBackFromNote`, not a tag invalidation — see fix #195.) | Done | 20-A, 20-B |
| 20-D | **Actions + tag index.** `useActions(noteId)` + action mutations (also invalidate `keys.todos`); `useTags()` (dedups NoteView+ListView's two `getTags` fetches) + tag-index invalidation. Note-applied tags stay local (→ 20-E). Component-only, no `App.tsx`. | Done | 20-A |
| 20-E | **Note detail.** `getNoteDetail` + `editContent`/`setNoteDate`/`analyseNote` refetch (NoteView has the most mutations). | Not Started | 20-A |
| 20-F | **Meetings.** `getMeetingsForDate` + create-from-meeting / next-occurrence / link; preserve Phase 16's reminders-vs-browsed-day decoupling. | Not Started | 20-A |
| 20-G | **Cleanup.** Remove dead hand-rolled hooks + remaining manual invalidation; fold retry/backoff into `QueryClient` defaults (subsumes Phase 19's 19-H); learnings. | Not Started | 20-B…20-F |

> **The whole phase is gated on the ADR** — do not start 20-A until ADR 0010 is superseded. **20-A is the keystone**: it sets the conventions (key factory, optimistic `onMutate`/rollback template, retry/error defaults) every later slice copies — get it right before fanning out. 20-B…20-F are independent *domains* and could parallelise after 20-A, **except** 20-B and 20-C both edit `App.tsx`, so sequence those (per the "same-file → don't parallelise" rule). **Subsumes 19-H** — don't also run it. **Transcription credentials stay hand-rolled** (short-lived STS creds fetched once before streaming aren't cacheable server state).

**Learning surface:** a server-state library's cache/dedup/invalidation model vs hand-rolled effects; query keys and cache granularity; `useMutation` optimistic-update-with-rollback (`onMutate`/`onError`/`onSettled`) replacing manual try/catch reverts; `invalidateQueries` replacing cross-view manual refetch; incremental migration with two systems coexisting; the dependency/bundle tradeoff the ADR weighed.

---

## Slices

Each migrates one domain: add `useQuery`/`useMutation` hooks over the existing `api/<domain>.ts` functions, swap the component onto them, and delete that domain's hand-rolled read effect + manual optimistic handlers. Every slice ships green with the rest of the app still hand-rolled. The optimistic-UI rule (CLAUDE.md) is satisfied by `onMutate`/rollback — surface failures the same as today.

- **Gate — supersede ADR 0010.** New ADR: context (the trigger — recurring staleness / duplicate fetches, outgrowing the learning-vehicle framing, or rollback plumbing becoming a liability), decision (adopt TanStack Query, incremental), consequences. Supersedes, does not edit, 0010.
- **20-A — Foundation + todos pilot.** Root `QueryClientProvider` (above/around `AuthProvider`); `api/queryKeys.ts` factory; `QueryClient` defaults (staleTime, retry — low, since `apiFetch` already handles auth refresh); `@tanstack/react-query-devtools` (dev-only). Migrate `TodoSection` as the worked template (Appendix A). **Install on Node 20 to match CI** before committing `package-lock.json`.
- **20-B — Folders (tree).** Biggest manual-invalidation payoff. Migrates the folder *tree* domain only (`keys.folders`): `getFolders` read + create/rename/delete/move-folder mutations. `moveNoteToFolder`/`unfileNote` mutate *note cards* (hand-rolled until 20-C) so they stay hand-rolled this slice — migrating them now would mean a TanStack mutation writing hand-rolled `useState`. Folder-tree mutations **do** use `onSettled: invalidateQueries` (temp-id→real-id reconciliation + multiple downstream readers).
- **20-C — Note cards / list.** The big `App.tsx` consolidation. Today `App.tsx` holds a hand-rolled `cards: NoteCard[]` (GET `/notes/cards`) **and** `useNotes()` holds a separate `notes: {noteId,title}[]` (GET `/notes`) — two fetches, duplicated CRUD. Unify into one `useNoteCards()` (`keys.noteCards`); migrate create/rename/delete + move-to-folder/unfile to mutations; delete `useNotes`. Wire the deferred cross-domain invalidations: `useDeleteFolder` (20-B) and the tag mutations (20-D, card tag pills) invalidate `keys.noteCards`. Now that `App.tsx`-editing phases (21/22) have landed, the hub file is clear.
- **20-D — Actions + tag index.** Two component-scoped domains, **no `App.tsx`**. Actions: `useActions(noteId)` + add/complete/reopen/delete in `ActionsSection`, optimistic + `onSettled` invalidate `keys.actions(noteId)` **and `keys.todos`** (actions surface as todos — close the loop both ways). Tags: `useTags()` (`keys.tags`) replaces the two separate hand-rolled `getTags()` reads in `NoteView` (`allTags`) and `ListView` (filter); `tagNote`/`untagNote` mutations invalidate `keys.tags`. Note-applied tags (`NoteView`'s local `tags`) stay hand-rolled until 20-E. `useTagSuggestions` is pure `useMemo` — untouched.
- **20-E — Note detail.** Largest mutation surface.
- **20-F — Meetings.** Watch the reminders/browsed-day split.
- **20-G — Cleanup.** Delete dead code; retry/backoff via `QueryClient` defaults; remove `App.tsx` manual refetch entirely.

---

## Slice 20-A — Foundation + todos pilot

**Status:** Done

**User value:** None directly (infrastructure + a like-for-like migration of one domain). Establishes the TanStack template the rest of Phase 20 copies. Behaviour for todos is unchanged — proven by the existing `TodoSection` suite staying green.

### Scenarios

```
Scenario: Todos load and render unchanged
  Given the todos endpoint returns open and completed items
  When the home screen renders TodoSection
  Then the open and Done lists appear exactly as before the migration

Scenario: Completing a todo is optimistic and rolls back on failure
  Given an open todo
  When I complete it and the request fails
  Then it shows completed immediately, then reverts to open
  And the failure is surfaced as it is today (no silent rollback)

Scenario: Adding a todo updates the shared cache optimistically
  Given the add input
  When I submit a new to-do
  Then it appears immediately and its temp id is swapped for the server id on success
  And it is removed if the create fails
```

### Acceptance criteria

- [x] `@tanstack/react-query` added to `web/package.json`; `package-lock.json` generated on **Node 20** so `npm ci` is green in CI
- [x] `QueryClientProvider` wraps the app at the root (`main.tsx`); a single `QueryClient` with sane defaults (`retry: 1`, `staleTime: 30s`, `refetchOnWindowFocus: false`, mutations `retry: false` — `apiFetch` already handles auth refresh)
- [x] `web/src/api/queryKeys.ts` key factory added (`todos`, plus the keys later slices will use)
- [x] `TodoSection` reads via `useTodos` (`useQuery`) and mutates via `useCompleteTodo`/`useReopenTodo`/`useDeleteTodo` (`useMutation`, `onMutate` optimistic + `onError` rollback); the add flow writes the cache via `setQueryData`; **per-item busy preserved**
- [x] No hand-rolled `getTodos` `useEffect` remains in `TodoSection`
- [x] Optimistic-UI rule satisfied — apply immediately, roll back **and surface** the failure on error
- [x] Component tests render through a `QueryClientProvider` (`src/test/render.tsx` helper); full Vitest suite + `tsc -b`/build + ESLint green
- [x] Only the todos domain migrated; folders/notes/actions/tags/meetings remain hand-rolled (coexistence intact)
- [x] Dev-only `@tanstack/react-query-devtools` wired in `main.tsx` (excluded from prod bundle)

---

## Slice 20-B — Folders (tree)

**Status:** Done

**User value:** None directly (like-for-like migration of the folder-tree domain). Removes the four `getFolders().then(setFolders)` manual refetches in `App.tsx` — the largest manual-invalidation surface in the app — replacing them with one `useFolders()` read and four `useMutation`s that reconcile via `invalidateQueries`. Folder behaviour is unchanged, proven by the existing folder suites staying green.

**Scope.** Folder *tree* server-state only (`keys.folders`): the `getFolders` read and the `createFolder` / `renameFolder` / `deleteFolder` / `moveFolder` mutations. `moveNoteToFolder` and `unfileNote` mutate **note cards** (App's hand-rolled `cards` state, migrating in 20-C) — they stay hand-rolled this slice; migrating them now would mean a TanStack mutation writing hand-rolled `useState`, the coexistence anti-pattern. Local UI state that *derives* from a folder (active-folder id/path, breadcrumb `view`, preview id/name) stays `useState` — this slice moves only the folder tree itself.

### Scenarios

```
Scenario: Folders load and render unchanged
  Given the folders endpoint returns a folder tree
  When the app renders the sidebar
  Then the folder tree appears exactly as before the migration

Scenario: Creating a folder is optimistic and reconciles the real id
  Given the new-folder input
  When I create a folder
  Then it appears immediately with a temporary id
  And after the create resolves the tree reflects the server's real id

Scenario: Creating a folder rolls back on failure
  Given the new-folder input
  When I create a folder and the request fails
  Then the optimistic folder is removed and the failure surfaces as it does today

Scenario: Renaming a folder is optimistic and rolls back on failure
  Given an existing folder
  When I rename it and the request fails
  Then it shows the new name immediately, then reverts to the old name

Scenario: Renaming the active folder updates the heading optimistically
  Given I am viewing a folder
  When I rename that folder
  Then the main heading shows the new name immediately

Scenario: Deleting a folder removes it optimistically and rolls back on failure
  Given an existing folder
  When I delete it and the request fails
  Then it disappears immediately, then reappears

Scenario: Moving a folder reparents it optimistically and rolls back on failure
  Given two folders
  When I drag one onto the other and the request fails
  Then it shows under the new parent immediately, then reverts

Scenario: A folder mutation in one view updates every view
  Given the sidebar tree and a folder picker both read folders
  When I rename a folder
  Then both reflect the new name without a manual refetch
```

### Acceptance criteria

- [x] `web/src/hooks/useFolders.ts` reads via `useQuery({ queryKey: keys.folders, queryFn: getFolders })`; `App.tsx` consumes it and passes the tree down as today (Sidebar/FolderTree/FolderPicker/FolderPreview props unchanged)
- [x] The `getFolders().then(setFolders)` initial `useEffect` and the `folders`/`setFolders` `useState` are removed from `App.tsx`
- [x] `useFolderMutations` exposes `useCreateFolder`/`useRenameFolder`/`useDeleteFolder`/`useMoveFolder` (`useMutation`, `onMutate` optimistic tree edit + `onError` rollback + `onSettled: invalidateQueries({ queryKey: keys.folders })`)
- [x] Create swaps the optimistic `temp-…` id for the server id via the `onSettled` refetch (no manual id reconciliation in `App.tsx`)
- [x] Renaming the active folder still updates the derived `activeFolderPath` breadcrumb optimistically (local UI state stays in `App.tsx`; the `view` state machine was removed by 21-A's router, so only `activeFolderPath` remains)
- [x] The four manual `getFolders().then(setFolders)` refetch calls are deleted from the folder handlers
- [x] `moveNoteToFolder`/`unfileNote` remain hand-rolled over the `cards` state (unchanged this slice); todos (20-A) stay on TanStack; everything else stays hand-rolled (coexistence intact)
- [x] Optimistic-UI rule satisfied — apply immediately, roll back on error; failure surfacing unchanged from today (folder-tree errors currently roll back without a toast — adding toasts is out of scope)
- [x] Folder component tests render through the `src/test/render.tsx` QueryClient helper; `FolderMutations`/`FolderNavigation` (App-level) updated to drive folders via the cache; full Vitest suite + `tsc -b`/build + ESLint green
- [x] Self/descendant folder-move guarded (optimistic move would otherwise orphan the subtree; backend has no cycle guard) — added in `App.handleMoveFolder` + `useMoveFolder` (Hawk)
- [x] Tree helpers extracted to `web/src/folderTree.ts` (`mapTree`/`removeFromTree`/`insertIntoTree`/`findNode`), shared by the hooks

### Observability

1. **Silent optimistic divergence (tree).** Each of create/rename/delete/move must roll back on error or the sidebar tree drifts ahead of the server. Guard per mutation with a component test that forces the request to reject and asserts the tree reverts (and surfacing is unchanged from today).
2. **Delete-folder note orphaning (known coexistence gap).** The backend moves a deleted folder's notes to unfiled, but `noteCards` is hand-rolled until 20-C, so deleting a folder does **not** refresh the cards list this slice — the home/list view can briefly show notes under a now-deleted folder until the next card refetch. This matches today's behaviour (the current `handleDeleteFolder` also doesn't refresh cards); 20-C wires `useDeleteFolder` to also `invalidateQueries({ queryKey: keys.noteCards })`. Note it; do not fix here.
3. **Over-invalidation.** `invalidateQueries` is scoped to `keys.folders` only — one refetch per mutation, no fan-out. Do not invalidate `["folders"]`-adjacent keys.

---

## Slice 20-C — Note cards / list

**Status:** Done

**User value:** None directly (consolidation + like-for-like migration of the home note list). Removes the duplicated note state and the manual cross-view refetches; a note created/renamed/deleted/moved in any view reflects everywhere via one cache.

**The consolidation.** Today there are two overlapping note states:
- `App.tsx` `cards: NoteCard[]` — GET `/notes/cards`, the full home/folder list (title, preview, date, tags, folderId, openActions).
- `useNotes().notes: {noteId,title}[]` — GET `/notes`, used only for the `NoteView` title lookup, plus its `create`/`rename`/`remove` + `creating`/`createError`.

20-C unifies both into one `useNoteCards()` query (`keys.noteCards`) and deletes `useNotes`. The `NoteView` title lookup reads the cards cache; `creating`/`createError` come from the create mutation.

**Scope.**
- `web/src/hooks/useNoteCards.ts` — `useQuery({ queryKey: keys.noteCards, queryFn: getNoteCards })`. Replaces the `cards` `useState` + `getNoteCards` effect in `App.tsx`.
- `web/src/hooks/useNoteMutations.ts` — `useCreateNote`, `useRenameNote`, `useDeleteNote`, `useMoveNoteToFolder` (folderId `string | null`; null → `unfileNote`). Optimistic on `keys.noteCards` + `onError` rollback + `onSettled` invalidate `keys.noteCards`. Create reconciles the temp id via the refetch (or inserts the real id on success, matching today).
- `App.tsx` handlers (`handleNewNote`, `handleDelete`, `handleDeleteNote`, `handleRename`, `handleMoveNoteToFolder`) rewired onto the mutations; the `cards`/`setCards`/`cardsRef` state and the manual `getNoteCards().then(setCards)` calls (incl. the on-back refetch → becomes `invalidateQueries(keys.noteCards)`) deleted.
- `NoteCard.tsx` stops owning its `deleteNote` API call; `onDelete` drives `useDeleteNote` in the parent (NoteCard becomes presentational). `ListView` keeps wrapping `onDelete={() => onDeleteNote(card.noteId)}`.
- Delete `web/src/hooks/useNotes.ts` (sole consumer is `App.tsx`).
- **Deferred cross-domain invalidation now wired:** `useDeleteFolder` (20-B) adds `keys.noteCards` invalidation (backend orphans a deleted folder's notes to unfiled).
- **Tag → card-pill refresh:** handled by `handleBackFromNote` invalidating `keys.noteCards` on return from NoteView — **not** by a tag-mutation invalidation. (20-C briefly added tag→`keys.noteCards`, but `AppContent`'s `useNoteCards` is always mounted, so it forced a GET `/notes/cards` on every keystroke-level tag op while the list wasn't visible — churn that flaked the tag E2E journeys. Reverted in fix #195; tags are only edited in NoteView, so the return-path invalidation covers it.)

**Out of scope:** `getNoteDetail`/`editContent`/`analyseNote`/`setNoteDate` semantics for the open note (20-E) — except `setNoteDate` stays a direct call inside the create flow (default date). Action mutations do **not** invalidate `keys.noteCards` (NoteCard hides `openActions` — CHANGE-10). Meetings (20-F).

### Scenarios

```
Scenario: The note list loads and renders unchanged
  Given the cards endpoint returns notes
  When the home list renders
  Then the cards appear exactly as before the migration

Scenario: Creating a note inserts it and navigates to it
  Given the home list
  When I create a new note
  Then the new note opens, and on return it appears in the list (server id, not a temp id)

Scenario: Renaming a note is optimistic and rolls back on failure
  Given a note in the list
  When I rename it and the request fails
  Then the new title shows immediately, then reverts

Scenario: Deleting a note is optimistic and rolls back on failure
  Given a note in the list
  When I delete it and the request fails
  Then it disappears immediately, then reappears

Scenario: Moving a note to a folder is optimistic and rolls back on failure
  Given a note and a folder
  When I drag the note onto the folder and the request fails
  Then the card shows the new folder immediately, then reverts

Scenario: Deleting a folder refreshes the note list
  Given a folder containing notes
  When I delete the folder
  Then the orphaned notes reappear as unfiled in the list (cards refetched)

Scenario: Tagging a note in the note view updates its home card
  Given a note open in the note view
  When I add a tag
  Then the note's home card shows the new tag without a manual refetch

Scenario: One cache, no duplicate fetch
  Given the home list and the note-view title lookup both need notes
  Then notes are read from one shared cache (GET /notes/cards once); GET /notes is gone
```

### Acceptance criteria

- [x] `web/src/hooks/useNoteCards.ts` (`useQuery`, `keys.noteCards`) is the single source for the note list; `App.tsx`'s `cards`/`setCards`/`cardsRef` state and `getNoteCards` effect are removed
- [x] `web/src/hooks/useNoteMutations.ts` exposes `useCreateNote`/`useRenameNote`/`useDeleteNote`/`useMoveNoteToFolder` (optimistic `onMutate` + `onError` rollback + `onSettled` invalidate `keys.noteCards`); create returns the real `noteId` and inserts the real-id card on success
- [x] `App.tsx`'s five card handlers are rewired onto the mutations; `creating`/`createError` for `ListView` come from the create mutation; the on-back manual refetch becomes `invalidateQueries(keys.noteCards)`. `handleNewNote` **awaits** `setNoteDate` before navigating (fix #195 — else the card is date-less and hidden by the home filter)
- [x] `NoteCard.tsx` no longer calls `deleteNote` directly — `onDelete` drives `useDeleteNote` in the parent; `NoteView`'s title lookup reads the `useNoteCards` cache
- [x] `web/src/hooks/useNotes.ts` deleted; no remaining `getNotes`/`listNotes` read for the list (GET `/notes` no longer called from the list path). *(`listNotes` export remains, used only by `Auth.test` as an auth probe — remove in 20-G.)*
- [x] `useDeleteFolder` (20-B) additionally invalidates `keys.noteCards`. *(Tag mutations do **not** — reverted in fix #195; `handleBackFromNote` covers the card-pill refresh on return.)*
- [x] Action mutations do **not** invalidate `keys.noteCards` (openActions not shown); meetings/note-detail stay hand-rolled (coexistence intact); todos/folders/actions/tags stay on TanStack
- [x] Optimistic-UI rule satisfied — apply immediately, roll back on error (forced-reject tests for rename/delete/move)
- [x] App-rendering tests provide a `GET /notes/cards` MSW handler; `ListView`/`NoteCardDelete`/`FolderMutations`/`FolderRouting`/`Routing`/`NoteView` tests updated/green; full Vitest suite + `tsc -b`/build + ESLint green

### Observability

1. **Silent optimistic divergence (notes).** rename/delete/move must roll back on error or the list drifts ahead of the server. Forced-reject test per mutation.
2. **Create temp-id reconciliation.** The new card must end up with the **server** id (navigation + later mutations key off it). Assert the real id appears after the create settles, not just the title text.
3. **Delete-folder → orphan refresh.** Closes the 20-B gap: deleting a folder now refetches `keys.noteCards` so orphaned notes show as unfiled. Cover with the folder-delete scenario.
4. **Tag → card pill staleness.** Closes the 20-D gap, but via `handleBackFromNote` (return-path `keys.noteCards` invalidation), **not** a tag-mutation invalidation — the latter churned the always-mounted `useNoteCards` on every tag op and flaked the E2E (fix #195). Tags are only edited in NoteView, so the return path covers it.
5. **No double fetch.** GET `/notes` (listNotes) must be gone from the list path — one `GET /notes/cards` feeds both the list and the title lookup.

---

## Slice 20-D — Actions + tag index

**Status:** Done

**User value:** None directly (like-for-like migration of two component-scoped domains). Completing or deleting an action inside a note now updates the home to-do list without a remount, and tagging a note refreshes the tag filter/suggestions everywhere — both via cache invalidation rather than the current per-component refetch.

**Scope.** Two domains, **entirely within components — no `App.tsx` changes** (deliberate: keeps clear of `App.tsx`-editing phases).
- **Actions** (`keys.actions(noteId)`): migrate `ActionsSection` fully — `useActions(noteId)` read + `useAddAction`/`useCompleteAction`/`useReopenAction`/`useDeleteAction`. Optimistic + rollback; `onSettled` invalidates `keys.actions(noteId)` **and `keys.todos`** (the home to-do list shows actions). Close the loop the other way: the 20-A todo mutations (`useTodoMutations`) invalidate `keys.actions(item.noteId)` for `type:"action"` items so an open `ActionsSection` reflects a todo-list completion.
- **Tag index** (`keys.tags`): `useTags()` replaces the two independent `getTags().then(set…)` effects in `NoteView` (`allTags`) and `ListView` (filter) — one shared cache. `useTagNote`/`useUntagNote` wrap `tagNote`/`untagNote` and `onSettled`-invalidate `keys.tags`.

**Out of scope this slice:** the note's **applied** tags (`NoteView`'s local `tags` state) are note-detail state → migrate in 20-E (`keys.note`). 20-D keeps that optimism local; it only migrates the global tag *index* read + invalidation. `useTagSuggestions` is a pure `useMemo` — untouched. `keys.noteCards` is not invalidated (no consumer until 20-C).

### Scenarios

```
Scenario: A note's actions load and render unchanged
  Given the actions endpoint returns items for a note
  When the note's Actions section renders
  Then the open and completed actions appear as before the migration

Scenario: Adding an action is optimistic and reconciles the real id
  Given the action input
  When I add an action
  Then it appears immediately and its temp id is swapped for the server id on success
  And it is removed if the create fails

Scenario: Completing an action is optimistic and rolls back on failure
  Given an open action
  When I complete it and the request fails
  Then it shows completed immediately, then reverts to open

Scenario: Deleting an action rolls back on failure
  Given an action
  When I delete it and the request fails
  Then it disappears immediately, then reappears

Scenario: Completing an action in a note updates the home to-do list
  Given an action that also appears in the home to-do list
  When I complete it from the note's Actions section
  Then the home to-do list reflects the completion without a manual refetch

Scenario: The tag index is fetched once and shared
  Given NoteView and ListView both need the tag index
  When both are mounted
  Then the tag index is read from one shared cache (no duplicate fetch)

Scenario: Tagging a note refreshes the tag index everywhere
  Given a note and the home tag filter
  When I add a tag to the note
  Then the tag filter and suggestions reflect the new tag without a manual refetch
```

### Acceptance criteria

- [x] `web/src/hooks/useActions.ts` reads via `useQuery({ queryKey: keys.actions(noteId), queryFn: () => getActions(noteId) })`; `ActionsSection` consumes it (no hand-rolled `getActions` `useEffect`/`useState` remains)
- [x] `useActionMutations` exposes add/complete/reopen/delete (`useMutation`, `onMutate` optimistic + `onError` rollback); per-item busy preserved (local in-flight sets). **As shipped:** complete/reopen/delete invalidate `keys.todos` only (single `keys.actions` consumer — keystone principle); `add` also invalidates `keys.actions` for the temp-id swap
- [x] Add swaps the optimistic temp id for the server id via the `onSettled` refetch; `onCountChange` to `NoteView` still fires
- [x] `useTodoMutations` (20-A) additionally invalidates `keys.actions(item.noteId)` for `type:"action"` items so an open `ActionsSection` reflects a home-list completion
- [x] `web/src/hooks/useTags.ts` (`useQuery`, `keys.tags`) replaces the hand-rolled `getTags().then(setAllTags)` in `NoteView` and `getTags().then(setTagEntries)` in `ListView` — both read the shared cache
- [x] `useTagMutations` (`useTagNote`/`useUntagNote`) wrap `tagNote`/`untagNote` and `onSettled`-invalidate `keys.tags`; `NoteView`'s applied-tags optimism stays local but reverts on mutation error
- [x] `useTagSuggestions` unchanged; note-applied tags (`NoteView` local `tags`) not migrated (→ 20-E)
- [x] **No `App.tsx` changes**; todos (20-A) + folders (20-B) stay on TanStack; note cards/meetings/note-detail stay hand-rolled (coexistence intact)
- [x] Optimistic-UI rule satisfied — apply immediately, roll back on error (forced-reject tests for add/complete/delete; surfacing unchanged from today)
- [x] `ActionsSection.test.tsx` rendered through the QueryClient helper with mutation-aware MSW handlers + a cross-view action→todo test; `NoteView.test.tsx` moved to the helper; `TagFilter`/`ListView`/`TagsSection` tests stay green; full Vitest suite + `tsc -b`/build + ESLint green

### Observability

1. **Silent optimistic divergence (actions).** Each of add/complete/reopen/delete must roll back on error or the section drifts ahead of the server. Guard per mutation with a forced-reject component test asserting the row reverts.
2. **Cross-view action↔todo sync.** Action mutations invalidate `keys.todos` and the todo mutations invalidate `keys.actions(noteId)`. If either direction is dropped, completing in one view leaves the other stale during coexistence. Cover with the "completing in a note updates the home to-do list" scenario.
3. **Tag-index over-invalidation.** Every tag add/remove invalidates `keys.tags` (one refetch). Acceptable — the index is small and read by two views. Do not invalidate `keys.noteCards` yet (no consumer until 20-C).
4. **Tag write fan-out.** `handleAddTags` issues one `tagNote` per token in a loop; ensure the index is invalidated once after the batch settles, not per token, to avoid a refetch storm on a multi-tag paste.

---

## Slice 20-E — Note detail

**Status:** Not Started

**User value:** None directly (like-for-like migration of the note-detail domain — the largest single-component mutation surface). One `getNoteDetail` read replaces the `useEffect` fetch in `NoteView`; content/date/analysis/applied-tags/link mutations become `useMutation`s with optimistic rollback. Behaviour is unchanged, proven by the existing `NoteView` suite staying green.

**The migration.** `NoteView` holds **one** read effect — `getNoteDetail(noteId)` (GET `/notes/{id}`) — populating ~11 server-state fields (`content`, `date`, `tags`, `transcriptText`, `summary`, `discussionPoints`, `decisions`, `summaryModelId`, `linkedMeeting`, `recurringSeriesId`, `transcriptDraft`). 20-E unifies that into one `useNoteDetail(noteId)` query on the pre-declared `keys.note(id)` (currently defined but unused). The manual `refreshNote()` refetch becomes `invalidateQueries({ queryKey: keys.note(noteId) })`.

**Scope.**
- `web/src/hooks/useNoteDetail.ts` — `useQuery({ queryKey: keys.note(noteId), queryFn: () => getNoteDetail(noteId) })`. Replaces the `getNoteDetail` effect + the ~11 `useState`s it feeds. `notFound`/`loadingDetail` derive from the query (`isLoading`, error). The default-date-on-load call (`setNoteDate` when a note has no date) moves into the create flow / a mutation, not the read.
- `web/src/hooks/useNoteDetailMutations.ts` — `useEditContent`, `useSetNoteDate`, `useAnalyseNote`, `useLinkNoteToCalendar`. Optimistic `onMutate` on the `keys.note(id)` cache + `onError` rollback + `onSettled` invalidate `keys.note(id)`.
- **Applied tags** (deferred from 20-D): `NoteView`'s local `tags` state folds into the note-detail cache. `handleAddTags`/`handleRemoveTag` keep firing `useTagNote`/`useUntagNote` (20-D, which invalidate the global `keys.tags` index) but their optimism now mutates the `keys.note(id)` cache via `onMutate` snapshots; rollback restores the snapshot. The per-token `tagNote` loop still invalidates `keys.tags` once after the batch settles (20-D rule), not per token.
- `analyseNote` replaces `refreshNote()` — `onSettled` invalidates `keys.note(noteId)`; the editor re-reads `summary`/`discussionPoints`/`decisions`/`summaryModelId` from the cache.
- `linkNoteToCalendar` (today hand-rolled optimistic in `NoteView`, lines ~184–207) becomes `useLinkNoteToCalendar`: optimistic `linkedMeeting`/`recurringSeriesId` on the note-detail cache, rollback + surface error on failure.

**Out of scope:** the TipTap editor's in-progress text stays **local** UI state — only the *save* (`editContent` on blur) is a mutation. `title` stays a prop driven by the parent `onRename` (note-cards domain, 20-C). `actionCount`/`ActionsSection` already on TanStack (20-D). The meetings *list* `linkedNoteId` staleness after a link is pre-existing and handled by 20-F (not this slice). `transcriptText`/`transcriptDraft` recovery (`completeTranscription`/`discardTranscriptionDraft`) refetch via `keys.note(id)` invalidation but are not re-architected. No `keys.noteCards` invalidation — content/date/analysis don't change card-visible fields, and the card-pill tag refresh is already covered by `handleBackFromNote` (20-C, fix #195).

### Scenarios

```
Scenario: Note detail loads and renders unchanged
  Given the note-detail endpoint returns a note
  When NoteView opens
  Then content, date, tags, summary and linked meeting render exactly as before the migration

Scenario: Saving edited content surfaces a failure
  Given an open note
  When I edit the content and the save (on blur) fails
  Then the failure surfaces as it does today (no silent loss)

Scenario: Setting the note date is optimistic and rolls back on failure
  Given an open note
  When I change its date and the request fails
  Then the new date shows immediately, then reverts

Scenario: Adding an applied tag is optimistic and rolls back on failure
  Given an open note
  When I add a tag and the request fails
  Then the tag pill shows immediately, then is removed, and the failure surfaces

Scenario: Generating final notes refetches the detail
  Given an open note with a transcript
  When I generate final notes
  Then the summary, discussion points and decisions appear from the refetched detail (no manual refreshNote)

Scenario: Linking a meeting is optimistic and rolls back on failure
  Given an open note and a meeting
  When I link the meeting and the request fails
  Then the linked-meeting banner shows immediately, then reverts, and the failure surfaces

Scenario: One cache for note detail
  Given NoteView reads note detail
  Then it is read from keys.note(id) (GET /notes/{id} once), shared across re-renders
```

### Acceptance criteria

- [ ] `web/src/hooks/useNoteDetail.ts` (`useQuery`, `keys.note(noteId)`) is the single source for note detail; `NoteView`'s `getNoteDetail` `useEffect` and the ~11 `useState`s it fed are removed (`loadingDetail`/`notFound` derive from the query)
- [ ] `web/src/hooks/useNoteDetailMutations.ts` exposes `useEditContent`/`useSetNoteDate`/`useAnalyseNote`/`useLinkNoteToCalendar` (optimistic `onMutate` on `keys.note(id)` + `onError` rollback + `onSettled` invalidate `keys.note(id)`)
- [ ] `analyseNote` replaces the manual `refreshNote()` refetch with `invalidateQueries({ queryKey: keys.note(noteId) })`; the editor re-reads summary/discussion/decisions/model from the cache
- [ ] Applied tags: `NoteView`'s local `tags` state folds into the `keys.note(id)` cache; `handleAddTags`/`handleRemoveTag` optimism mutates that cache and rolls back on error; `useTagNote`/`useUntagNote` still invalidate the global `keys.tags` index once per batch (not per token)
- [ ] `linkNoteToCalendar` is migrated to `useLinkNoteToCalendar` (optimistic `linkedMeeting`/`recurringSeriesId`, rollback + surfaced error); the hand-rolled try/catch in `NoteView` is removed
- [ ] TipTap in-progress text stays local; only `editContent` (on blur) is a mutation; `title`/`actionCount` unchanged; no `keys.noteCards` invalidation added
- [ ] Todos/folders/note-cards/actions/tags stay on TanStack; meetings/transcription stay hand-rolled (coexistence intact)
- [ ] Optimistic-UI rule satisfied — apply immediately, roll back **and surface** on error (forced-reject tests for date/tag/link)
- [ ] `NoteView.test.tsx` (already on the `src/test/render.tsx` QueryClient helper) updated with note-detail MSW handlers + forced-reject mutation tests; full Vitest suite + `tsc -b`/build + ESLint green

### Observability

1. **Silent optimistic divergence (detail).** date/tag/link must roll back on error or NoteView drifts ahead of the server. Forced-reject test per mutation, asserting revert **and** surfaced failure.
2. **Content-save loss.** `editContent` saves on blur; a dropped save with no surfaced error silently loses an edit. Assert the failure surfaces (toast/`role="alert"`), matching today.
3. **analyse refetch.** Generating final notes must repaint summary/discussion/decisions from the refetched detail — assert the new fields appear after `analyseNote` settles, not stale ones.
4. **No card over-invalidation.** 20-E must **not** invalidate `keys.noteCards` (card-visible fields unchanged; refresh already covered by `handleBackFromNote`). Guard against a refetch storm on every keystroke-level detail op.

---

## Slice 20-F — Meetings

**Status:** Not Started

**User value:** None directly (like-for-like migration of the meetings domain). Today's and the browsed day's meeting lists move onto one cache; create-from-meeting and next-occurrence become mutations. Behaviour is unchanged, proven by the existing meetings suites staying green.

**The decoupling that must survive (Phase 16).** `MeetingsSection` holds **two independent** fetches: `todayState` (real today, feeds `useMeetingReminders`) and `browsed` (the date the user is navigating). Reminders are scheduled **only** from `todayState` (`reminderMeetings = todayState.loaded ? … : NO_MEETINGS`), so date navigation never reschedules or clears today's reminders. A naive migration that unifies both into a single `keys.meetings(date)` cache breaks this: on navigating away, the reminder feed would see the new day's (or empty) data and drop today's timers.

**Scope.**
- `web/src/hooks/useMeetings.ts` — **two** distinct query keys to preserve the decoupling:
  - `keys.meetingsToday` (no date param) → `getMeetingsForDate(tz, today)`. Feeds `useMeetingReminders` — never re-keyed by navigation.
  - `keys.meetingsBrowsed(date)` → `getMeetingsForDate(tz, date)`, enabled only when `selectedDate !== today`. Date-keyed so each day caches independently; browsing back to today reads `keys.meetingsToday` from cache.
  - `MeetingPicker` (read-only, inside NoteView) reads `keys.meetingsBrowsed(date)` too — sharing the cache.
- `web/src/hooks/useMeetingMutations.ts` — `useCreateNoteFromMeeting`, `useCreateNoteFromNextOccurrence`. Optimistic cache edits on the relevant meetings key + rollback + `onSettled` invalidate.
  - `createNoteFromMeeting`: on success set the meeting's `linkedNoteId` in the meetings cache, open the note, **invalidate `keys.noteCards`** (it creates a card). Per-meeting busy (`creating: Set`) + per-meeting `createErrors` preserved (local in-flight, like `ActionsSection`).
  - `createNoteFromNextOccurrence`: optimistic `hasNextOccurrenceNote = true` flip across the series in the meetings cache, store the real `noteId` (`nextNoteIds`) on success, rollback the flag on error. Invalidate `keys.noteCards`.
- `selectedDate`/`pickerOpen` stay **local** `useState` (UI navigation, not server state). `meetingDay.ts` pure helpers unchanged.

**Out of scope:** `linkNoteToCalendar` is migrated in **20-E** (it mutates note-detail `linkedMeeting`, not the meetings list). The meetings-list `linkedNoteId` going briefly stale after a link is **pre-existing** behaviour (today the list only refreshes on Retry / date-nav); 20-F does not add cross-invalidation from the note-detail link back into the meetings cache — note it, don't fix. Transcription credentials stay hand-rolled.

### Scenarios

```
Scenario: Today's meetings load unchanged and reminders are scheduled
  Given the meetings endpoint returns today's meetings
  When MeetingsSection renders
  Then today's meetings appear as before and reminders are scheduled from today only

Scenario: Browsing to another day does not disturb today's reminders
  Given today's meetings are loaded and reminders scheduled
  When I navigate to a different day
  Then that day's meetings load and today's reminders are unchanged

Scenario: Browsing back to today reads the cache
  Given I navigated away and back to today within the stale window
  Then today's meetings render from cache without a refetch

Scenario: Creating a note from a meeting opens it and refreshes the list
  Given a meeting with no linked note
  When I create a note from it
  Then the note opens, the meeting shows as linked, and the home note list includes it (cards invalidated)

Scenario: Creating a note from a meeting surfaces a per-meeting failure
  Given a meeting
  When create-from-meeting fails
  Then the error surfaces against that meeting only and its busy state clears

Scenario: Creating a next-occurrence note is optimistic and rolls back on failure
  Given a recurring meeting series
  When I create the next-occurrence note and it fails
  Then the "has next note" flag flips immediately, then reverts

Scenario: The meeting picker shares the meetings cache
  Given MeetingPicker browses a day already fetched
  Then it reads from keys.meetingsBrowsed(date) without a duplicate fetch
```

### Acceptance criteria

- [ ] `web/src/hooks/useMeetings.ts` exposes `useMeetingsToday()` (`keys.meetingsToday`) and `useMeetingsBrowsed(date)` (`keys.meetingsBrowsed(date)`, `enabled: date !== today`); `MeetingsSection` consumes both; `MeetingPicker` reads `useMeetingsBrowsed`
- [ ] `useMeetingReminders` is fed **only** from `useMeetingsToday` data — date navigation never re-keys or clears the reminder feed (Phase 16 decoupling preserved)
- [ ] `web/src/api/queryKeys.ts` gains `meetingsToday` and `meetingsBrowsed: (date) => […]`
- [ ] `useMeetingMutations` exposes `useCreateNoteFromMeeting` (on success set `linkedNoteId` in the meetings cache + open note + invalidate `keys.noteCards`; per-meeting `creating`/`createErrors` preserved) and `useCreateNoteFromNextOccurrence` (optimistic `hasNextOccurrenceNote` flip + `nextNoteIds` reconcile + rollback + invalidate `keys.noteCards`)
- [ ] The `getMeetingsForDate().then(setTodayState/setBrowsed)` effects and the `todayState`/`browsed` `useState`s are removed from `MeetingsSection` and `MeetingPicker`; `selectedDate`/`pickerOpen` stay local
- [ ] `linkNoteToCalendar` is **not** touched here (migrated in 20-E); the meetings-list `linkedNoteId`-after-link staleness is left as today (noted, not fixed)
- [ ] Todos/folders/note-cards/actions/tags/note-detail stay on TanStack; transcription stays hand-rolled (coexistence intact)
- [ ] Optimistic-UI rule satisfied — apply immediately, roll back **and surface** on error (forced-reject tests for create-from-meeting and next-occurrence)
- [ ] `MeetingsSection.test.tsx`/`MeetingPicker.test.tsx` (already on the QueryClient helper, `useMeetingReminders` mocked) updated with meetings MSW handlers + a reminders-decoupling test (navigate day, assert reminder feed unchanged); full Vitest suite + `tsc -b`/build + ESLint green

### Observability

1. **Reminders decoupling regression.** The headline risk: a unified cache lets date navigation clear today's reminders. Cover with a test that loads today, navigates to another day, and asserts the reminder feed (today's meetings) is unchanged.
2. **Silent optimistic divergence (next-occurrence).** The `hasNextOccurrenceNote` flip must roll back on error or the button drifts to "Open Note" for a note that was never created. Forced-reject test.
3. **Create-from-meeting → card refresh.** Creating a note from a meeting must invalidate `keys.noteCards` so the new note appears in the home list. Assert the card appears.
4. **Per-meeting busy/error isolation.** A failed create on one meeting must not clear another's busy state or show its error against the wrong row. Assert errors and busy flags are keyed per meeting.

---

## Slice 20-G — Cleanup

**Status:** Not Started

**User value:** None directly (dead-code removal + centralised network resilience). Closes Phase 20: every server-state domain is on TanStack, the last hand-rolled remnants are deleted, and transient-error retry/backoff is folded into one place (subsuming Phase 19's 19-H).

**Scope.**
- **Delete `listNotes`** (`api/notes.ts`) — sole remaining consumer is `Auth.test.tsx`'s auth-probe (asserts the `Authorization` header is set/omitted). Rewrite that probe against another simple read (e.g. `getTags`) or a direct MSW-observed `fetch`, then remove the export. Confirm GET `/notes` is gone from every path.
- **Network resilience in `apiFetch` (subsumes 19-H)** — add exponential backoff with jitter for transient failures (`res.status >= 500 || === 429`, and thrown `TypeError`/network errors), honouring `Retry-After`. **Idempotent requests only** (GET + idempotent PUT/DELETE) — **never** auto-retry POST creators. The existing 401 auth-refresh stays **outside** the transient-retry loop. This is the central default; remove any need for per-hook retry config.
- **QueryClient defaults review** — confirm the `main.tsx` defaults (`retry: 1`, `staleTime: 30s`, `refetchOnWindowFocus: false`, mutations `retry: false`) are the single source; no per-hook overrides exist (audited: none), so nothing to fold beyond confirming.
- **Dead-code sweep** — no hand-rolled `useState`+`useEffect` fetch remains in `src/` after 20-E/20-F; `keys.note(id)` is now in use (20-E); no unused query keys. `App.tsx`'s one remaining `invalidateQueries(keys.noteCards)` in `handleBackFromNote` is intentional (20-C) and **kept**.
- **Learnings** — Phase 20 retro (the library's cache/dedup/invalidation model vs hand-rolled; incremental two-system coexistence; the dependency/bundle tradeoff).

**Depends on:** 20-B…20-F (every domain migrated before the seam is removed). **Subsumes 19-H** — do not also run it.

### Scenarios

```
Scenario: A transient 5xx on a GET is retried with backoff
  Given a GET that returns 503 then 200
  When apiFetch issues it
  Then it backs off, retries, and resolves with the 200 (no error surfaced)

Scenario: A 429 honours Retry-After
  Given a GET that returns 429 with Retry-After
  When apiFetch issues it
  Then the retry waits at least the Retry-After interval

Scenario: A POST creator is never auto-retried
  Given a POST that returns 503
  When apiFetch issues it
  Then it fails without a transient retry (no duplicate create)

Scenario: The auth probe no longer depends on listNotes
  Given the Auth tests
  When they assert the Authorization header
  Then they use a retained read endpoint, and listNotes is gone

Scenario: No hand-rolled server fetch remains
  Given the migrated app
  Then no component reads server state via useEffect + useState (all via useQuery/useMutation)
```

### Acceptance criteria

- [ ] `listNotes` removed from `api/notes.ts`; `Auth.test.tsx` auth-probe rewired to a retained endpoint (or direct MSW-observed `fetch`); no GET `/notes` remains in any path
- [ ] `apiFetch` retries transient failures (`>=500`, `429`, network `TypeError`) with exponential backoff + jitter, honouring `Retry-After`; **idempotent methods only** (GET/PUT/DELETE), never POST; 401 auth-refresh stays outside the transient loop (subsumes 19-H)
- [ ] QueryClient defaults confirmed as the single retry/stale source; no per-hook overrides remain
- [ ] No hand-rolled `useState`+`useEffect` server-fetch remains anywhere in `web/src/` (grep `.then(set`, `getX().then`, effect-driven api calls); every domain on `useQuery`/`useMutation`
- [ ] `keys.note(id)` in use; no unused query keys; `App.tsx`'s `handleBackFromNote` `invalidateQueries(keys.noteCards)` retained (intentional)
- [ ] `docs/learnings/phase-20g-…md` (or `_minor-log.md` entry) written; ADR 0010 supersession already recorded (Gate)
- [ ] Full Vitest suite + `tsc -b`/build + ESLint green; backend/eventstore unaffected

### Observability

1. **Retry must not duplicate writes.** The backoff loop must exclude POST. A retried create is a duplicate note/folder/action. Cover with the "POST never auto-retried" scenario.
2. **Retry must terminate.** Bounded attempts + capped backoff or a slow endpoint hangs the UI. Assert a max attempt count and that exhaustion surfaces the error.
3. **Auth-refresh isolation.** The 401 refresh path must stay separate from the transient loop — a 401 inside the backoff would re-trigger refresh repeatedly. Assert 401 still routes to the single auth-refresh, not the retry loop.
4. **No silent hand-rolled survivor.** A missed `useEffect` fetch would keep a domain off the cache (stale-on-mutation). The grep-clean assertion is the guard.

---

## Appendix A — What one domain migration looks like (todos)

The concrete shape, using `TodoSection` (the 20-A pilot). Three new files, one slimmed component.

### New: `api/queryKeys.ts` (created once in 20-A)

```ts
export const keys = {
  todos: ["todos"] as const,
  folders: ["folders"] as const,
  noteCards: ["noteCards"] as const,
  tags: ["tags"] as const,
  note: (id: string) => ["note", id] as const,
  actions: (noteId: string) => ["actions", noteId] as const,
} as const;
```

### New: `hooks/useTodos.ts` — the read (replaces the `useEffect` + `useState` + `cancelled` guard)

```ts
import { useQuery } from "@tanstack/react-query";
import { getTodos } from "../api/todos";
import { keys } from "../api/queryKeys";

export function useTodos() {
  return useQuery({ queryKey: keys.todos, queryFn: getTodos });
}
```

### New: `hooks/useTodoMutations.ts` — one mutation (replaces a manual optimistic handler)

```ts
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { completeTodo } from "../api/todos";
import { completeAction } from "../api/actions";
import { keys } from "../api/queryKeys";
import type { TodoItem } from "../api/todos";

export function useCompleteTodo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (item: TodoItem) =>
      item.type === "action"
        ? completeAction(item.noteId!, item.itemId)
        : completeTodo(item.itemId),
    onMutate: async (item) => {                              // optimistic
      await qc.cancelQueries({ queryKey: keys.todos });
      const previous = qc.getQueryData<TodoItem[]>(keys.todos);
      const completedAt = new Date().toISOString();
      qc.setQueryData<TodoItem[]>(keys.todos, (old) =>
        old?.map((i) => (i.itemId === item.itemId ? { ...i, completedAt } : i)));
      return { previous };
    },
    onError: (_e, _item, ctx) => {                           // rollback
      if (ctx?.previous) qc.setQueryData(keys.todos, ctx.previous);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: keys.todos }), // reconcile
  });
}
```

### Changed: `TodoSection.tsx` — before vs after

**Before** (hand-rolled — the read + one mutation):

```ts
const [items, setItems] = useState<TodoItem[]>([]);
const [loading, setLoading] = useState(true);
const [busy, setBusy] = useState<Set<string>>(new Set());

useEffect(() => {
  let cancelled = false;
  getTodos()
    .then((data) => { if (!cancelled) { setItems(data); setLoading(false); } })
    .catch(() => { if (!cancelled) setLoading(false); });
  return () => { cancelled = true; };
}, []);

async function handleComplete(item: TodoItem) {
  if (busy.has(item.itemId)) return;
  addBusy(item.itemId);
  const completedAt = new Date().toISOString();
  setItems((prev) => prev.map((i) => i.itemId === item.itemId ? { ...i, completedAt } : i));
  try {
    if (item.type === "action") await completeAction(item.noteId!, item.itemId);
    else await completeTodo(item.itemId);
  } catch {
    setItems((prev) => prev.map((i) => i.itemId === item.itemId ? { ...i, completedAt: null } : i));
  } finally {
    removeBusy(item.itemId);
  }
}
```

**After** (TanStack):

```ts
const { data: items = [], isLoading: loading } = useTodos();
const complete = useCompleteTodo();
// onChange={() => complete.mutate(item)}
```

### What actually changes, per domain

| Concern | Before | After |
|---|---|---|
| Read | `useEffect` + `useState` + `cancelled` guard, per component | `useQuery` one-liner; cache shared across views, dedup + stale-while-revalidate free |
| Optimistic update | manual `setItems(... map ...)` in the handler | `onMutate` snapshot + `setQueryData` |
| Rollback on error | manual `catch` reverting to a captured value | `onError` restores the `onMutate` snapshot |
| Cross-view sync | manual `getX().then(setX)` refetch (e.g. `App.tsx`) | `invalidateQueries` in `onSettled` — every view re-reads |
| `loading` flag | hand-tracked `useState` | `isLoading` from the hook |

**The one nuance to budget for:** per-item **busy** state. Today `busy: Set<string>` disables the specific row in flight; `useMutation.isPending` is per *hook*, not per item. Preserve it with `complete.isPending && complete.variables?.itemId === item.itemId`, or keep a small local in-flight set. Flag this in 20-A so the template covers it once.

---

## Out of scope

- **Transcription credentials** — one-shot short-lived STS creds, not cacheable server state; stay hand-rolled.
- **A SWR alternative** — the ADR reversal commits to TanStack Query specifically; don't re-litigate the library choice here.
- **Local UI state** (modals, inputs, view kind) — stays `useState`; this phase only moves *server* state.

---

## Observability

1. **Silent optimistic divergence.** The risk that survives the migration is the same as today's: an optimistic update that isn't rolled back on error, leaving the UI ahead of the server. Guard per slice with a component test that forces the mutation to reject and asserts the row reverts **and** the failure is surfaced (toast/`role="alert"`), exactly as the hand-rolled version must.
2. **Over-invalidation refetch storms.** `invalidateQueries` after every mutation can fan out into many refetches; if a slice invalidates broadly (e.g. `["note"]` for all notes on a single-note edit), watch the network panel and scope keys tightly.
3. **Coexistence drift.** While half the app is hand-rolled and half is TanStack, a mutation in one half won't invalidate the other's cache. Keep each domain wholly on one side per slice; 20-G removes the seam. Fold the `observability-brief` skill into each slice's spec when Breaker drafts it.
