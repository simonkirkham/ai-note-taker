# Phase 22-B — Home search bar

**Slice:** 22-B · **PR:** #189 · **Deploy:** #480 · **Date:** 2026-06-08

The frontend half of search: a debounced as-you-type search bar that fuzzy-queries the 22-A endpoint and replaces the home card grid with ranked matches. Two learnings worth keeping.

## 1. Place a feature in the child component to dodge a parallel slice's shared-file conflict

22-B was built **in parallel** with 22-A's deploy, while slice 20-B (folders → TanStack) was actively editing `App.tsx` on its own branch. The obvious home for search state was `App.tsx` (it owns the `cards` array). Instead, search was put **entirely inside `ListView`** (the child that already receives `cards` + `onOpenNote` and owns the home filters) — `App.tsx` was **not touched at all**.

Result: when 20-B merged first, merging `origin/main` into the 22-B branch was **conflict-free** — 20-B changed `App.tsx`/folder hooks, 22-B changed `ListView`/search. The token log shows 20-B paid for "two mid-build rebases onto shared `App.tsx`"; 22-B paid nothing because it never entered that file.

**Lesson:** when two slices run concurrently and one will churn a shared parent (`App.tsx`, a context, `main.tsx`), deliberately scope the other's changes to a **child component** if the data is already available there. File-ownership separation is a cheaper conflict-avoidance tool than careful merging. (Reinforces the CLAUDE.md "same-file → don't parallelise" rule — here we kept them off the same file *by design* rather than sequencing.)

## 2. The `set-state-in-effect` gate: key the fetched slice, compute the displayed state

The prototype tripped `react-hooks/set-state-in-effect` (a hard lint gate). The real `useNoteSearch` avoids it structurally, not by suppression:
- The debounced effect calls `setState` **only inside the timeout's `.then`/`.catch`** — never synchronously in the effect body. The blank-query branch just bumps the request ref and returns.
- The displayed state is **computed** by keying the fetched result to the live query (`fetched.key === query ? fetched.state : LOADING`), so a query change shows loading without a synchronous reset.
- A monotonic `reqId` ref, re-checked in `.then`/`.catch`, discards stale (out-of-order) responses; `clearTimeout` on change/unmount cancels a superseded debounce before it fires.

This is the canonical shape for any debounced as-you-type fetch in this codebase. Run `npm run lint` (not just `tsc`/`vitest`) on changed frontend files — this rule is eslint-only.

## Minor
- Search returns a lean `{ noteId, title, snippet, score, matchedField }`; results render by **joining ranked `noteId`s to the already-loaded `cards`** (overriding the preview with the snippet), with a minimal-card fallback when a result isn't in the loaded set. Server order is preserved (render maps over the results array, not the cards). Valid because the home currently loads all cards; revisit when pagination lands.
- Stylist (`ui-ux-pro-max`) was **skipped**: the bar reuses design tokens + the existing `NoteCard` grid (no new visual paradigm) and the prototype already validated the look. Skipping Stylist is the right call for a minimal-surface slice on the established design system.
- `score`/`matchedField` are carried on the frontend type (honest mirror of the endpoint) but not yet displayed — forward-use for relevance/match-highlighting. The match-count header lacks an `aria-live` region; deferred to the Phase 19-F live-region cluster (loading/empty/error already announce via `role=status`/`alert`).
