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
| 20-F | **Meetings.** `useMeetings(date)` (`keys.meetings(date)`) — two date-keyed queries (today for reminders, selectedDate for display) preserve Phase 16's reminders-vs-browsed-day decoupling; create-from-meeting / next-occurrence / link mutations. App.tsx-free. | Not Started | 20-A |
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
- **20-F — Meetings.** `useMeetings(date)` over `getMeetingsForDate`, keyed by date (`keys.meetings(date)`). The Phase 16 reminders-vs-browsed-day decoupling becomes two date-keyed queries: `useMeetings(today)` (always active → feeds `useMeetingReminders`, auto-cached so returning to today never refetches) and `useMeetings(selectedDate)` (display; dedups with the today query when equal). Migrate the meeting mutations (`createNoteFromMeeting`, `createNoteFromNextOccurrence`, `linkNoteToCalendar`) to `useMeetingMutations`, invalidating `keys.meetings(date)` (+ `keys.noteCards` for the create flows). NoteView's `handleLinkMeeting`/`handleOpenNextOccurrence` use the hooks but keep their local `linkedMeeting`/`recurringSeriesId` optimism (note-detail → `keys.note` invalidation deferred to 20-E). `MeetingPicker` also reads `useMeetings(date)`.
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

## Slice 20-F — Meetings

**Status:** Not Started

**User value:** None directly (like-for-like migration of the home meetings panel). The reminders-vs-browsed-day behaviour and the create/link flows are unchanged; the win is one shared, deduped, cached meetings cache instead of hand-rolled `todayState`/`browsed` fetches.

**The Phase 16 decoupling, restated in TanStack.** Today MeetingsSection holds two states — `todayState` (sticky, anchored to today, feeds `useMeetingReminders`) and `browsed` (transient, for the navigated day) — with two guarded effects so browsing never refetches/clobbers today, and reminders fire only for today. This becomes **two date-keyed queries**:
- `useMeetings(today)` — always mounted; its data feeds `useMeetingReminders`. Cached under `keys.meetings(today)`, so navigating away and back to today never refetches.
- `useMeetings(selectedDate)` — drives the displayed list. When `selectedDate === today` it is the *same query key* as the reminders query → React Query dedups to one fetch. When browsing, it is a distinct key (distinct cache), and the today query stays untouched.
- Reminders read **only** from the today query, never the browsed one — preserving the decoupling structurally.

**Scope.**
- Add `keys.meetings: (date: string) => ["meetings", date]` to `queryKeys.ts`.
- `web/src/hooks/useMeetings.ts` — `useMeetings(date)` = `useQuery({ queryKey: keys.meetings(date), queryFn: () => getMeetingsForDate(tz, date) })`. Returns the `MeetingsResult` discriminated union (`{meetings}` | `{error}`) as data; `{error}` is a *loaded-but-unavailable* state (calendar not connected), not a query error.
- `MeetingsSection.tsx` — replace `todayState`/`browsed` `useState` + the two fetch effects with `useMeetings(today)` + `useMeetings(selectedDate)`; derive `displayState` and `reminderMeetings` (from the today query) as today. Keep all local UI state (`selectedDate`, `pickerOpen`, `bannerDismissed`) and the per-meeting loading/error maps (`creating`, `createErrors`, `creatingNext`, `nextNoteIds`).
- `MeetingPicker.tsx` — its date-navigable fetch reads `useMeetings(date)`.
- `web/src/hooks/useMeetingMutations.ts` — `useCreateNoteFromMeeting`, `useCreateNoteFromNextOccurrence`, `useLinkNoteToCalendar`. Optimistic where the current code is (e.g. `createNoteFromMeeting` sets `linkedNoteId` on the meeting); `onSettled` invalidate `keys.meetings(date)`; the create flows also invalidate `keys.noteCards` (a new note enters the list).
- `NoteView.tsx` `handleLinkMeeting` / `handleOpenNextOccurrence` call the new mutation hooks but keep their local `linkedMeeting`/`recurringSeriesId` optimism (note-detail state). The mutations invalidate `keys.meetings`; **`keys.note` invalidation is deferred to 20-E** (note-detail not yet migrated).

**Out of scope:** `useMeetingReminders` stays a side-effect hook (timers; not server state) — it just consumes the today query's meetings. Transcription. Note-detail (`keys.note`) — 20-E.

### Scenarios

```
Scenario: Today's meetings load and render unchanged
  Given the calendar returns today's meetings
  When the home meetings panel renders
  Then today's meetings appear as before, and reminders are scheduled for them

Scenario: Reminders stay anchored to today while browsing
  Given I am viewing today's meetings
  When I navigate to another day
  Then the list shows that day's meetings
  And the reminder schedule still reflects only today's meetings

Scenario: Returning to today does not refetch
  Given I navigated away from today and back
  Then today's meetings are served from cache (no second calendar request)

Scenario: Calendar-unavailable is a loaded state, not an error
  Given the calendar endpoint returns { error }
  When the panel renders
  Then it shows the unavailable state (not a retry-spinner loop)

Scenario: Creating a note from a meeting links it and opens it
  Given a meeting with no linked note
  When I create a note from it
  Then the meeting shows as linked immediately and the new note opens

Scenario: Linking a note to a meeting is optimistic and rolls back on failure
  Given an unlinked note and the meeting picker
  When I link a meeting and the request fails
  Then the linked badge shows immediately, then reverts and the picker reopens
```

### Acceptance criteria

- [ ] `keys.meetings(date)` added; `web/src/hooks/useMeetings.ts` reads via `useQuery` and returns the `MeetingsResult` union (loaded/unavailable derived from data, loading from `isLoading`)
- [ ] `MeetingsSection` uses `useMeetings(today)` (reminder source) + `useMeetings(selectedDate)` (display); `todayState`/`browsed` state + both fetch effects removed; reminders fed only from the today query; returning to today does not refetch (same key, cached)
- [ ] `MeetingPicker` reads `useMeetings(date)`
- [ ] `useMeetingMutations` exposes `useCreateNoteFromMeeting`/`useCreateNoteFromNextOccurrence`/`useLinkNoteToCalendar` (optimistic where today is; `onSettled` invalidate `keys.meetings(date)`; create flows also invalidate `keys.noteCards`)
- [ ] `NoteView`'s `handleLinkMeeting`/`handleOpenNextOccurrence` use the hooks, keep local `linkedMeeting`/`recurringSeriesId` optimism + rollback; `keys.note` invalidation deferred to 20-E (note it)
- [ ] `useMeetingReminders` unchanged (consumes the today query's meetings)
- [ ] Optimistic-UI rule satisfied — apply immediately, roll back on error
- [ ] `MeetingsSection`/`MeetingPicker`/`useMeetingReminders` tests stay green (esp. the reminders-decoupling + no-refetch-on-return tests); App-rendering tests already stub `/calendar/:date`; full Vitest suite + `tsc -b`/build + ESLint green

### Observability

1. **Reminders decoupling regression.** The highest-risk behaviour: reminders must stay anchored to today and not refire/clear when browsing. Preserve the two existing decoupling tests verbatim; they pass only if the today query is the sole reminder source.
2. **Calendar-unavailable vs query error.** `{error}` from the endpoint is a *successful* response carrying an unavailable marker — it must not put `useQuery` into an error/retry state. Keep retry low and treat the union in `data`. A 5xx is a real query error (retry per defaults).
3. **Create/link cross-view.** create-from-meeting adds a note (invalidate `keys.noteCards`) and links a meeting (invalidate `keys.meetings(date)`); link sets the meeting's `linkedNoteId`. If the meetings invalidation is dropped, the "linked" badge won't appear until a manual refetch.
4. **No browsed→today refetch storm.** Confirm `useMeetings(selectedDate)` for a browsed day does not invalidate or refetch the today query (distinct keys); the network panel should show exactly one today fetch per session plus one per distinct browsed day.

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
