# Phase 5-N — Folder Navigation Component Tests

**Slice:** 5-N  
**Merged:** 2026-05-15  
**PR:** #42

---

## What we built

Moved 5 of 7 folder navigation tests from `FolderNavigationJourney.cs` (Playwright E2E) into a new `FolderNavigation.test.tsx` component test file (Vitest + RTL + MSW). The 2 tests that verify real API round-trips for folder creation were kept as E2E. Added `GET /notes` and `GET /folders` to the shared MSW default handlers. Pruned 6 now-unused `AppPage.cs` methods.

---

## Learnings

### 1. The E2E cost test: ask "does this need a real network boundary?"

The 5 migrated tests (folder heading, Home heading, todo section visibility, unfiled notes button) all passed without any backend. They were testing React state transitions (`handleFolderSelect`, `handleHome`) and conditional rendering (`!isInFolder && <TodoSection />`). The 2 kept tests (`CreateFolder_AppearsInSidebar`, `CreateSubfolder_AppearsNested`) verify that a POST to `/folders` triggers a state refresh and the new folder appears — they genuinely need the real stack.

Rule of thumb: if MSW can satisfy the test completely, the test belongs in the component layer.

### 2. Render `<App>` (not individual components) when testing App state machines

For click-to-navigation tests, the behavior under test is: sidebar click → `handleFolderSelect` in App → `setView` → ListView receives `folderPath` → heading changes. Rendering only `ListView` in isolation with a pre-set `folderPath` prop would skip the App state machine entirely and give no confidence that the click actually wires up. Rendering `<App>` with MSW is the right level for this class of test.

Corollary: for purely conditional-render tests (TodoSection visible/hidden based on `currentFolderId`), rendering `ListView` in isolation would be lighter. For this slice, keeping all 5 in `<App>` was simpler and consistent. Either approach is defensible — the key is the decision is explicit.

### 3. Scope RTL queries to their subtree to prevent "multiple elements" failures

`screen.findByText('People')` throws if the text appears in more than one place in the rendered tree. After clicking, "People" could appear in both the sidebar and the page heading. Scoping with `within(screen.getByTestId('sidebar')).findByText('People')` mirrors exactly what the E2E `AssertFolderVisibleInSidebarAsync` was doing and avoids fragile ordering assumptions.

### 4. Default MSW handlers should cover every API call `<App>` makes on mount

App mounts with three concurrent fetches: `GET /notes` (via `useNotes`), `GET /folders`, and `GET /notes/cards`. Before this slice, only `/notes/cards` was in the shared defaults — the others were unhandled, causing silent `.catch(() => {})` swallowing in App. Adding them to `handlers.ts` as empty-list defaults means any future test that renders `<App>` gets a clean starting state without having to repeat boilerplate per file.

### 5. Conditional unmount vs CSS visibility: document the assertion choice

`TodoSection` is conditionally unmounted (`{!isInFolder && <TodoSection />}`) — not hidden with CSS. The correct assertion is `.not.toBeInTheDocument()`, not `.not.toBeVisible()`. These are semantically different: `.not.toBeVisible()` would pass even if the element is in the DOM but CSS-hidden, while `.not.toBeInTheDocument()` would fail in that case. A short comment marks the choice as deliberate so a future refactor that switches to CSS visibility knows to update the assertion.

---

## Applied status

| Learning | Status |
|---|---|
| 1. E2E cost test — "does this need a real network boundary?" | Documented — apply during E2E test reviews |
| 2. Render `<App>` for App state machine tests | Applied — used in `FolderNavigation.test.tsx` |
| 3. Scope RTL queries with `within()` to prevent multi-match errors | Applied — `within(getByTestId('sidebar')).findByText(...)` in all click tests |
| 4. Default handlers cover all App mount calls | Applied — `GET /notes` and `GET /folders` added to `handlers.ts` |
| 5. Document conditional-unmount assertion choice with a comment | Applied — comment added to `folder view hides the todo section` test |
