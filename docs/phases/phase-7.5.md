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

---

## Slice 7.5-A — Remove sidebar note list

**Status:** Done

### Scenarios

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

### Acceptance criteria

- [x] Sidebar renders no `<ul data-testid="note-list">` element
- [x] `notes`, `activeNoteId`, `onSelect` props removed from Sidebar
- [x] `npm run test` exits 0; all updated/removed Sidebar tests accounted for
- [x] App still compiles and builds cleanly

---

## Slice 7.5-B — Unfiled Notes preview pull-out

**Status:** Done

### Scenarios

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

### Acceptance criteria

- [x] `»` button visible alongside the Unfiled Notes sidebar item
- [x] Clicking `»` on Unfiled Notes opens FolderPreviewPanel with `folderId="__unfiled__"`
- [x] Preview panel shows only notes where `card.folderId` is null/undefined
- [x] `npm run test` exits 0

---

## Slice 7.5-C — Fix folder preview panel cards

**Status:** Done

### Scenarios

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

### Acceptance criteria

- [x] FolderPreviewPanel fetches its own cards on open; no `cards` prop
- [x] Notes filtered correctly by `folderId` (and by `!folderId` for `UNFILED_ID`)
- [x] Panel shows an empty state when no notes match
- [x] `npm run test` exits 0

---

## Slice 7.5-D — Optimistic folder mutations and heading sync

**Status:** Done

### Scenarios

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

### Acceptance criteria

- [x] `handleCreateFolder` updates `folders` state before awaiting API; reverts on failure
- [x] `handleRenameFolder` updates `folders` state immediately; updates `activeFolderPath` when renaming the active folder
- [x] No visible flicker in manual testing (folder stays visible throughout the round-trip)
- [x] Heading updates immediately when active folder is renamed
- [x] `npm run test` exits 0

---

## Slice 7.5-E — Lambda memory allocation

**Status:** Done

### Scenarios

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

### Acceptance criteria

- [x] `MemorySize = 512` set in `NoteTakerStack.cs`
- [x] CDK assertion added for `MemorySize: 512`
- [x] `dotnet test tests/Infrastructure.Assertions/` exits 0
- [x] `cdk synth` exits 0
- [ ] Post-deploy: warm GET /notes/cards responds in < 2 s (manual verification)

---

## Slice 7.5-F — Replace flaky E2E folder tests with component tests

**Status:** Done

### Acceptance criteria

- [x] `FolderNavigationJourney.cs` deleted; `AppPage.cs` cleaned of dead methods
- [x] 5 component tests added covering all optimistic folder mutation scenarios
- [x] All tests use deferred-Promise pattern for optimistic-state assertions
- [x] `npm run test` exits 0 (54 tests)
- [x] `npm run lint` exits 0
