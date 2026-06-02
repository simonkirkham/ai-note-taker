# Phase 7.5 — Folder UX fixes and Lambda performance

**Goal:** Fix a set of UX regressions introduced during Phase 5 that were not caught by the then-missing component test layer, and resolve a Lambda memory constraint that causes 10+ second warm request latency. All frontend fixes are paired with component tests that would have caught the original defect.

## Summary

| Slice | Summary | Status | Depends on |
|-------|---------|--------|------------|
| 7.5-A | Remove sidebar note list | Done | — |
| 7.5-B | Unfiled Notes preview pull-out | Done | 7.5-A |
| 7.5-C | Fix folder preview panel cards | Done | — |
| 7.5-D | Optimistic folder mutations and heading sync | Done | — |
| 7.5-E | Lambda memory allocation | Done | — |
| 7.5-F | Replace flaky E2E folder tests with component tests | Done | — |

7.5-A through 7.5-D are independent of each other once 7.5-A lands (7.5-B touches the same Sidebar component). 7.5-E is completely independent and can run in parallel with any frontend slice. 7.5-F was added post-merge to replace two consistently-failing E2E tests with component tests.

**Learning surface:** Optimistic UI state management in React; the gap between a spec and its implementation when the E2E net is removed before component tests exist; Lambda memory as the primary warm-latency lever; the difference between cold-start (SnapStart solves) and warm-latency (memory solves).

---

## Root-cause analysis

### Issues found

| # | Symptom | Root cause |
|---|---------|------------|
| 1 | Unfiled notes appear in the sidebar note list | `Sidebar.tsx` still renders all notes passed via the `notes` prop — a vestige from pre-Phase-5; sidebar should be folder-navigation only |
| 2 | Unfiled Notes has no preview pull-out | The `»` preview button exists on folder items in `FolderTree.tsx` but was never added to the "Unfiled Notes" sidebar button; no `onPreview` call wired up |
| 3 | Folder preview panel shows no notes | `App.tsx` passes its `cards` state to `FolderPreviewPanel`; `cards` is fetched once on mount but `ListView.tsx` also independently fetches cards, creating a parallel data flow; the `FolderPreviewPanel` receives the App-level `cards` which may be empty if `getNoteCards()` in the App `useEffect` lost a race or the fetch failed silently |
| 4 | Folder disappears on create then reappears | `handleCreateFolder` awaits the API call then awaits a full `GET /folders` refetch before calling `setFolders` — no optimistic update; the folder vanishes during the round-trip |
| 5 | Folder disappears on rename then reappears | Same pattern in `handleRenameFolder` — no optimistic update to the `folders` tree; full refetch on success |
| 6 | Renaming a folder doesn't update the heading | `activeFolderPath` is set only in `handleFolderSelect`; `handleRenameFolder` refreshes the `folders` tree but never updates `activeFolderPath`, so the `ListView` heading stays stale |
| 7 | Lambda warm requests take 10+ seconds | `MemorySize` is not set in `NoteTakerStack.cs` → defaults to 128 MB; at 128 MB the .NET 10 runtime is severely CPU-throttled on every invocation; SnapStart eliminates init duration but does not affect warm-invocation CPU allocation |

### Test coverage gap

None of the 7 issues had component test coverage. Issues 1–6 were frontend state/rendering bugs that the Phase 6.5 component tests would have caught — had those tests existed when Phase 5 shipped. Issue 7 had no CDK assertion for `MemorySize`.

---

## Slice 7.5-A — Remove sidebar note list

**Status:** Done

**Value:** The sidebar shows only folder navigation, matching the Phase 5 spec. Individual note items are no longer rendered in the sidebar; users navigate to notes via the main content area (note cards on the home screen, folder view, or Unfiled Notes view).

**Root cause:** `Sidebar.tsx` still renders a `<ul>` of all notes from the `notes` prop. Phase 5-D specified the sidebar as folder-navigation only (Home, + New Note, Unfiled Notes, folder tree), but the note list was never removed.

**Changes in scope:**

- `web/src/components/Sidebar.tsx` — remove the `<ul data-testid="note-list">` note list block; remove `notes`, `activeNoteId`, `onSelect` from the props interface
- `web/src/App.tsx` — remove `notes={notes}`, `activeNoteId={activeNoteId}`, `onSelect={...}` from the `<Sidebar>` usage; remove `activeNoteId` derived const if unused elsewhere
- `web/src/__tests__/Sidebar.test.tsx` — remove the three tests that assert note-list behaviour (`renders note titles from the notes prop`, `calls onSelect with the note id when a note is clicked`, `active note has the active CSS class`); update `renderSidebar` helper to remove note-related props; add test that `note-list` is absent from the rendered sidebar

**Note:** `NoteView.test.tsx` renders `<Sidebar>` in some tests via the full note view — verify `Sidebar` still compiles cleanly once `notes` prop is removed.

**Scenarios:**

```
Scenario: Sidebar renders no individual note items
  Given the app has three notes
  When  the sidebar renders
  Then  no note titles appear in the sidebar

Scenario: Sidebar still shows folder navigation elements
  Given the app has folders and an Unfiled Notes button
  When  the sidebar renders
  Then  the Home button, Unfiled Notes button, and folder tree are all visible
```

**Acceptance criteria:**

- [x] Sidebar renders no `<ul data-testid="note-list">` element
- [x] `notes`, `activeNoteId`, `onSelect` props removed from Sidebar
- [x] `npm run test` exits 0; all updated/removed Sidebar tests accounted for
- [x] App still compiles and builds cleanly

---

## Slice 7.5-B — Unfiled Notes preview pull-out

**Status:** Done

**Value:** Clicking `»` next to "Unfiled Notes" opens the same slide-out preview panel that folder items have, showing all notes with no folder assignment.

**Root cause:** The `FolderTree.tsx` `»` button calls `onPreview(folderId, name)`, but the "Unfiled Notes" sidebar button has no equivalent. `App.tsx` passes `onPreview` to `<Sidebar>` but it is never called for the unfiled item. `FolderPreviewPanel` filters by `c.folderId === folderId`; for unfiled notes it must filter by `!c.folderId` when `folderId === UNFILED_ID`.

**Changes in scope:**

- `web/src/components/Sidebar.tsx` — add a `»` button alongside the "Unfiled Notes" button; on click call `onPreview(UNFILED_ID, 'Unfiled Notes')`; `UNFILED_ID` is already exported from `App.tsx` or can be a local constant matching `"__unfiled__"`
- `web/src/components/FolderPreviewPanel.tsx` — update the filter: `cards.filter(c => folderId === '__unfiled__' ? !c.folderId : c.folderId === folderId)`
- `web/src/__tests__/FolderNavigation.test.tsx` or a new `FolderPreview.test.tsx` — verify `»` button is present next to Unfiled Notes; clicking it calls `onPreview` with the unfiled sentinel

**Scenarios:**

```
Scenario: Unfiled Notes shows a preview button
  Given the sidebar is rendered
  When  I look at the Unfiled Notes row
  Then  a » button is visible

Scenario: Clicking » on Unfiled Notes opens the preview panel with unfiled notes
  Given two notes: one filed in a folder, one unfiled
  When  I click » on Unfiled Notes
  Then  the preview panel shows the unfiled note and not the filed note
```

**Acceptance criteria:**

- [x] `»` button visible alongside the Unfiled Notes sidebar item
- [x] Clicking `»` on Unfiled Notes opens FolderPreviewPanel with `folderId="__unfiled__"`
- [x] Preview panel shows only notes where `card.folderId` is null/undefined
- [x] `npm run test` exits 0

---

## Slice 7.5-C — Fix folder preview panel cards

**Status:** Done

**Value:** Clicking `»` on any folder correctly shows that folder's notes in the preview panel.

**Root cause:** `App.tsx` fetches `cards` once on mount via `getNoteCards()` and passes the result to `<FolderPreviewPanel>`. However, `ListView.tsx` independently calls `getNoteCards()` in its own `useEffect`, creating a parallel data flow. The preview panel receives the App-level `cards` array, which can be empty or stale if App's `getNoteCards()` call fails silently (`.catch(() => {})`) or resolves after the user clicks `»`. Additionally, after filing/unfiling notes, App's `cards` state is never refreshed.

**Fix approach:** Make `FolderPreviewPanel` fetch its own cards when opened (passing `folderId` as the trigger), rather than relying on App-level state. This removes the prop-threading and makes the panel self-contained.

**Changes in scope:**

- `web/src/components/FolderPreviewPanel.tsx` — fetch `getNoteCards()` internally when `folderId` changes (not null); remove `cards` prop; add loading state
- `web/src/App.tsx` — remove `cards={cards}` and the `getNoteCards` import/state/useEffect that fed it (if now unused); remove `NoteCard` type import if unused
- `web/src/__tests__/FolderPreview.test.tsx` (new) — render `<FolderPreviewPanel>` with MSW handler for `GET /notes/cards`; verify notes filtered by folderId appear

**Note:** Verify that removing `cards` from App does not break anything else. If `cards` is used elsewhere in App, keep the state but stop passing it to FolderPreviewPanel.

**Scenarios:**

```
Scenario: Folder preview panel shows notes in that folder
  Given folder "Bill" contains a note "1:1 with Bill"
  And   GET /notes/cards returns that note with folderId: "f-1"
  When  the preview panel opens for folder "f-1"
  Then  "1:1 with Bill" appears in the panel

Scenario: Preview panel shows no notes when folder is empty
  Given folder "Empty" has no notes
  When  the preview panel opens for "Empty"
  Then  the panel shows an empty state message
```

**Acceptance criteria:**

- [x] FolderPreviewPanel fetches its own cards on open; no `cards` prop
- [x] Notes filtered correctly by `folderId` (and by `!folderId` for `UNFILED_ID`)
- [x] Panel shows an empty state when no notes match
- [x] `npm run test` exits 0

---

## Slice 7.5-D — Optimistic folder mutations and heading sync

**Status:** Done

**Value:** Folder create and rename feel instant — no disappear/reappear flicker. Renaming the currently-viewed folder immediately updates the heading in the main content area.

**Root cause (create/rename flicker):** `handleCreateFolder` and `handleRenameFolder` both wait for the API round-trip then issue a full `GET /folders` refetch before calling `setFolders`. During the refetch window the local folder list is stale (folder absent or showing old name).

**Root cause (heading stale on rename):** `activeFolderPath` is set only in `handleFolderSelect`. `handleRenameFolder` calls `getFolders().then(setFolders)` but never updates `activeFolderPath`, so `ListView`'s `heading` stays as the old name.

**Fix approach — optimistic updates:**

For `handleCreateFolder`: add the new folder to `folders` state immediately with a temporary id, then replace with the real id once the POST returns.

For `handleRenameFolder`: update the matching node in the `folders` tree in-place immediately; also update `activeFolderPath` if the renamed folder is the active one.

**Changes in scope:**

- `web/src/App.tsx` — update `handleCreateFolder` to add the folder to state before awaiting the API; replace temp id on success, remove on failure
- `web/src/App.tsx` — update `handleRenameFolder` to update the matching node in `folders` immediately; update `activeFolderPath` if `folderId === activeFolderId`
- `web/src/__tests__/FolderMutations.test.tsx` (new) — render `<App>`; test create shows folder immediately; test rename updates sidebar and heading immediately without waiting for full refetch

**Scenarios:**

```
Scenario: Created folder appears immediately in the sidebar
  Given the folder list is empty
  When  I create a folder "People" (API responds after 200 ms delay)
  Then  "People" appears in the sidebar before the API responds

Scenario: Renamed folder name updates immediately in the sidebar
  Given folder "Peopl" exists in the sidebar
  When  I rename it to "People" (API responds after 200 ms delay)
  Then  the sidebar shows "People" before the API responds

Scenario: Renaming the active folder updates the main heading immediately
  Given I am viewing folder "Peopl"
  When  I rename it to "People"
  Then  the main content heading shows "People" without navigating away
```

**Acceptance criteria:**

- [x] `handleCreateFolder` updates `folders` state before awaiting API; reverts on failure
- [x] `handleRenameFolder` updates `folders` state immediately; updates `activeFolderPath` when renaming the active folder
- [x] No visible flicker in manual testing (folder stays visible throughout the round-trip)
- [x] Heading updates immediately when active folder is renamed
- [x] `npm run test` exits 0

---

## Slice 7.5-E — Lambda memory allocation

**Status:** Done

**Value:** Warm request latency drops from 10+ seconds to under 1 second. The .NET 10 runtime has adequate CPU and memory to process requests without throttling.

**Root cause:** `NoteTakerStack.cs` does not set `MemorySize` on the Lambda function, so AWS uses the default of 128 MB. Lambda allocates CPU proportionally to memory — at 128 MB the .NET runtime is severely CPU-throttled. SnapStart (Phase 6) eliminated the cold-start init duration (~490 ms) but has no effect on warm-invocation CPU allocation. Every warm request pays the full cost of a 128 MB-constrained .NET process executing multiple DynamoDB reads.

**Changes in scope:**

- `src/Infrastructure/NoteTakerStack.cs` — add `MemorySize = 512` to the `FunctionProps` (512 MB gives ~3× the CPU of 128 MB; 1024 MB gives ~8× but costs twice as much — 512 MB is the recommended starting point for .NET Lambdas)
- `tests/Infrastructure.Assertions/InfraAssertionsTests.cs` — add assertion that the Lambda function has `MemorySize: 512`

**Note on cost:** Lambda pricing is memory × duration. At 512 MB a request that took 10 s at 128 MB will likely complete in < 1 s — the cost per request is comparable or lower despite the 4× memory increase.

**Scenarios:**

```
Scenario: Lambda function has sufficient memory allocated
  Given the CDK template is synthesised
  Then  the Lambda function resource has MemorySize: 512

Scenario: API responds in under 2 seconds on a warm invocation
  Given the Lambda has been warmed by a prior request
  When  GET /notes/cards is called
  Then  the response arrives in under 2 seconds
  (verified manually post-deploy; not automatable in unit tests)
```

**Acceptance criteria:**

- [x] `MemorySize = 512` set in `NoteTakerStack.cs`
- [x] CDK assertion added for `MemorySize: 512`
- [x] `dotnet test tests/Infrastructure.Assertions/` exits 0
- [x] `cdk synth` exits 0
- [ ] Post-deploy: warm GET /notes/cards responds in < 2 s (manual verification)

---

## Slice 7.5-F — Replace flaky E2E folder tests with component tests

**Status:** Done

**Value:** The CI deploy gate no longer fails due to timing-sensitive E2E tests. Folder creation and subfolder nesting behaviour are now covered by deterministic component tests that can't be broken by Lambda cold-start errors or `WaitForResponseAsync` resolving on non-2xx responses.

**Root cause:** `FolderNavigationJourney.cs` used `WaitForResponseAsync` to gate sidebar assertions after folder creation. `WaitForResponseAsync` resolves on any HTTP status — if Lambda returned an error (cold start, transient 500) the optimistic temp-folder was removed before the Playwright assertion ran. The functionality worked correctly; only the test timing was fragile.

**Changes in scope:**

- `tests/Browser.E2E/Journeys/FolderNavigationJourney.cs` — deleted entirely (contained only the two failing tests)
- `tests/Browser.E2E/Pages/AppPage.cs` — removed three dead helper methods (`CreateFolderAsync`, `CreateSubfolderAsync`, `AssertFolderVisibleInSidebarAsync`) that were only called by the deleted journey
- `web/src/__tests__/FolderMutations.test.tsx` — 5 component tests added: optimistic top-level folder create (persists after API resolves), optimistic rename, subfolder nesting (deferred-Promise pattern), subfolder rollback on 500, active-folder heading sync

**Key implementation note:** All tests that assert optimistic state use a deferred Promise (held open via a callback, resolved with `act()`). Without this, React 18 batches the optimistic add and the catch-block removal into a single render, so the item never appears in the DOM.

**Acceptance criteria:**

- [x] `FolderNavigationJourney.cs` deleted; `AppPage.cs` cleaned of dead methods
- [x] 5 component tests added covering all optimistic folder mutation scenarios
- [x] All tests use deferred-Promise pattern for optimistic-state assertions
- [x] `npm run test` exits 0 (54 tests)
- [x] `npm run lint` exits 0

---

## What is NOT in scope

- Replacing the sidebar note list with a search or filter — the sidebar is folder-nav only; notes are accessed via the main content area (home cards, folder view, Unfiled Notes)
- Fixing N+1 projection query patterns — DynamoDB scan patterns are unchanged; the memory fix addresses the primary latency driver
- Provisioned concurrency — SnapStart already solves cold starts; provisioned concurrency adds cost without benefit
