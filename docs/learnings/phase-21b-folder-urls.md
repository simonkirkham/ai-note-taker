# Phase 21-B — Folder & sub-folder URLs

**Slice:** 21-B · **PR:** #190 · **Deploy:** #481 · **Date:** 2026-06-08

Routed folders (`/folders/:folderId`, `/folders/unfiled`) on top of 21-A and 20-B. Two learnings worth keeping.

## 1. Deriving UI state from the query cache deletes the manual rollback

Before: `handleRenameFolder` snapshotted `activeFolderPath`, optimistically rewrote the last breadcrumb segment, and restored it `onError` — a parallel optimism path the component owned.

After: `activeFolderPath` is a `useMemo` over `findPath(folders, activeFolderId)`, where `folders` is the **TanStack Query cache** that 20-B's rename hook already updates (and rolls back) optimistically via `setQueryData(mapTree(...))`. The breadcrumb heading now follows the cache for free — the entire manual snapshot/rewrite/restore block was deleted.

**Lesson:** once a piece of server state lives in a query cache with optimistic mutations, derive dependent UI from it rather than mirroring it in component state — the mirror is a second source of truth that needs its own rollback. This is the payoff of doing routing (21-B) *after* the TanStack migration (20-B), not before.

## 2. URL-based routing needs per-test URL isolation

Moving folder context from component state to the URL broke `FolderNavigation > home view shows the todo section`: jsdom's history URL **persists across renders within a test file**, so a prior test that navigated into a folder left the URL on `/folders/...`, and the next `render(<App/>)` opened a folder view instead of home. State-based nav didn't have this problem (a fresh render reset the state).

**Fix:** a global `afterEach(() => window.history.replaceState({}, '', '/'))` in `test/setup.ts`. **Guard `window`** — the Favicon suite opts into the `node` environment where `window` is undefined (`ReferenceError: window is not defined` until guarded with `typeof window !== 'undefined'`).

**Lesson:** the first slice that makes routing URL-driven must add a global URL reset to the shared test setup; without it, test order becomes load-bearing. (One-time infra fix, now in `test/setup.ts` — not a recurring cost.)

## Minor

- **Sub-folders need no nested URL.** A flat `/folders/:folderId` addresses any depth because the id is unique; `findPath` rebuilds the full `Parent → Child` breadcrumb from the tree. Name-path URLs (`/folders/parent/child`) were rejected — they rot on rename/reparent.
- **Deep-load flash (accepted):** on a cold `/folders/:id` load, if notes resolve before the folders tree, `findPath` returns `undefined` → empty path → the heading shows "Home" for ~one render until the tree fills. Plan-accepted; eliminable by gating the heading on `useFolders().isPending` if it ever annoys.
