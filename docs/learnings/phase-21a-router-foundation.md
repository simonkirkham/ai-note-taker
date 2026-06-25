# Phase 21-A — Router foundation + note & home URLs

**Slice:** 21-A · **PR:** #185 · **Deploy:** #476 · **Date:** 2026-06-08

Adopted React Router v7; mapped home and notes to real URLs (`/`, `/notes/:noteId`) so back/forward work and a note is deep-linkable. Three learnings worth keeping.

## 1. Import from `react-router`, not `react-router-dom`, or Vitest `vmThreads` breaks

**Symptom:** every test that imports the router fails at collection with `SyntaxError: Cannot use import statement outside a module … dom-export.mjs … seems to be an ES Module but shipped in a CommonJS package`.

**Cause:** `react-router-dom@7`'s CJS entry (`dist/index.js`) does `require("react-router/dom")`, whose export map resolves the `module` condition to a raw `.mjs`. The local **`vmThreads`** pool externalizes node_modules and `require()`s them as CJS — it cannot load that `.mjs`. `deps.inline` and the SSR optimizer both failed to fix it under `vmThreads`.

**Fix:** in v7 the packages merged — `BrowserRouter`, `Routes`, `Route`, `Navigate`, and all hooks are exported from **`react-router`** directly, and `react-router`'s CJS entry has **no `.mjs` require**. Depend on and import from `react-router`; drop `react-router-dom`. Tests pass with zero config workaround.

**Why it matters:** the `forks` pool (CI) tolerated the `-dom` shim, so CI was green while local `vmThreads` was red — a split that wastes time if you only test one pool. **Run new frontend deps under the local `vmThreads` pool, not just `CI=1` forks, before committing.**

## 2. A long-running slice must merge `main` before finalizing — parallel slices move shared infra

**What happened:** slice 20-A (TanStack Query) merged to `main` *during* 21-A. It migrated `TodoSection` to `useQuery` and added a shared `src/test/render.tsx` that wraps renders in `QueryClientProvider`. My branch predated it, so locally everything was green — but the PR's CI (which tests the branch **merged into current main**) failed: `Routing.test` rendered `<App/>` (home mounts `TodoSection`) without a `QueryClientProvider`.

**Fix:** `git merge origin/main` (clean — 20-A only touched `main.tsx`, not `App.tsx`), reinstall on Node 20 to reconcile the lock, and point `Routing.test` at the shared `test/render` helper.

**Why it matters:** local green ≠ mergeable when sibling slices touch shared infra (providers, the test render helper, `main.tsx`). **Before opening/finalizing a frontend PR, merge `origin/main` and re-run** — especially when other frontend slices are in flight (here: 20-A/20-B). CI's merge-result run is the source of truth, not the local branch.

## 3. Mount `<BrowserRouter>` inside `App`, not `main.tsx`

~30 test files render `<App/>` directly (not via `main.tsx`). Putting `<BrowserRouter>` inside `App` (wrapping the auth short-circuit) means none of them need a router wrapper, and new tests assert on `window.location.pathname` / set deep-links via `history.replaceState`. Mounting it in `main.tsx` would have forced a `MemoryRouter` edit across every App-rendering test.

## Minor

- **NoteView's header back affordance is state-dependent** — `back-button` only renders in some states; `note-title-input` is the stable "note screen rendered" marker for tests. A blank note shows `cancel-button` (wired to `onBack`), which is how the deep-link Back-fallback test triggers `onBack`.
- **`navigate(-1)` is a no-op on a cold deep-link** (no in-app history). Guard with `location.key === "default"` → `navigate("/")`. Caught by Hawk; the plan had specified the fallback but the first implementation dropped it.
