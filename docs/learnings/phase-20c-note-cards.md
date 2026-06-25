# Phase 20-C — Note cards / list TanStack Query migration

The big `App.tsx` consolidation: unified the duplicated `cards` state + `useNotes().notes` into one `useNoteCards()` query and deleted `useNotes`. PRs #194 (slice) + #195 (E2E fix-forward). Builds on [[phase-20a-tanstack-foundation-todos]], [[phase-20b-folders]], [[phase-20d-actions-tags]].

## A parent-level query is "always mounted" — child-route mutations that invalidate it churn

`useNoteCards()` is called in `AppContent`, which wraps **every** route (list AND note detail). So the noteCards query has an active observer even while you're deep in `NoteView`. 20-C added `keys.noteCards` invalidation to the tag mutations (to refresh the home card's tag pills). Consequence: every keystroke-level tag add/remove inside NoteView forced a `GET /notes/cards` **while the list wasn't even visible** — pure churn. Combined with the existing `keys.tags` refetch, it doubled per-tag network/re-render load and **flaked the `TagsJourney` E2E** (different test failed each deploy run — the signature of timing flakiness, not a deterministic break).

**Rule:** before invalidating a query from a mutation, ask *where is that query observed?* If it's observed by an always-mounted parent (not just the view the data is for), the invalidation refetches even when the data isn't on screen. Prefer invalidating on the **navigation back to the consuming view** (here `handleBackFromNote` already invalidates `keys.noteCards`) over invalidating from a mutation fired in an unrelated view. Tags are only edited in NoteView, so the return-path invalidation fully covers the card-pill refresh — the tag→noteCards invalidation was redundant *and* harmful. (Fix #195 removed it.)

## Don't make a filter-affecting write fire-and-forget

`handleNewNote` creates a note, then `setNoteDate(noteId, today)`. The home list **filters by date** (today/recent). 20-C changed `setNoteDate` from `await`ed to fire-and-forget. Race: the note-cards refetch on returning to the list could land **before** the date PATCH persisted → the new card had a null date → the home date filter **hid it** → the E2E couldn't find/click it. Restored the `await` (fix #195): the date is persisted before navigation, so any later refetch sees a dated card.

**Rule:** a write whose value gates list **visibility/filtering** must complete before the list can refetch — don't fire-and-forget it. Optimistic local state hid this in unit tests (the inserted card had `date: today`); only the real-stack E2E, which refetches from the server, exposed it.

## E2E is the only gate that catches these — and only post-merge

Both regressions passed every unit/integration test, `tsc`, ESLint, and the full Vitest suite (380 green), and Hawk approved. They surfaced **only** in the post-merge deploy E2E (Playwright against the real stack), which:
- refetches from the real server (exposing the unpersisted-date race that optimistic local state masked), and
- exercises real timing/throughput (exposing the invalidation churn).

So a clean local suite + green Hawk does **not** de-risk cache-invalidation/optimism changes against the real stack. Budget for a possible post-merge E2E fix on App.tsx-hub slices, and when an E2E flakes on a *different* test each run within one suite, suspect newly-added refetch churn rather than a flaky test.

## Consolidating two overlapping states

`App.tsx` had `cards` (GET `/notes/cards`, full) and `useNotes().notes` (GET `/notes`, id+title) — a legacy split. Unifying into `useNoteCards()`: the `NoteView` title lookup reads the cards cache (`notes={cards}` — `NoteCard[]` is structurally assignable to `{noteId,title}[]`); `creating`/`createError` come from the create mutation's `isPending`/`error`. `NoteCard` became presentational (delete via the parent's `useDeleteNote`, gated by the `onDelete` prop which also signals "deletable" for the one non-deletable render site). The old `listNotes` (GET `/notes`) is now dead except as an `Auth.test` auth probe → drop in 20-G.
