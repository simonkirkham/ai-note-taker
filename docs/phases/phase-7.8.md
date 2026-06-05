# Phase 7.8 — Production Pipeline and Note Screen UX

**Goal:** Establish a production deployment target and sharpen the note-screen interaction model with explicit lifecycle controls, keyboard-first focus, drag-and-drop note filing, and a layout that uses available screen space effectively.

## Summary

| Slice | Summary | Status | Depends on |
|-------|---------|--------|------------|
| 7.8-A | Production deployment pipeline | Done | — |
| 7.8-B | Note screen keyboard focus | Done | — |
| 7.8-C | Note screen save/cancel | Done | — |
| 7.8-D | Drag-and-drop notes into folder slide-out panel | Done | — |
| 7.8-E | Layout space review | Done | — |
| 7.8-F | Optimistic card state sync | Done | — |
| 7.8-G | Domain event dispatcher | Done | — |
| 7.8-H | Human-readable URLs | Done | 7.8-A |
| 7.8-I | Read-only smoke suite | Done | — |

All slices are independent and can run in any order. 7.8-B and 7.8-C both touch `NoteView.tsx` so should not run in parallel.

---

## Slice 7.8-A — Production deployment pipeline

**Status:** Done

### Scenarios

```
Scenario: A merge to main promotes through Test then deploys to Production
  Given the Test deploy succeeds
  When  the deploy workflow runs on main
  Then  the deploy-production job runs after the deploy job completes
  And   the Production environment receives the same CDK stack

Scenario: A Test deploy failure blocks production
  Given the Test deploy fails
  When  the deploy workflow runs on main
  Then  the deploy-production job does not start

Scenario: Smoke tests pass against the production API
  Given production has been deployed
  When  the deploy-production job runs acceptance specs
  Then  all Api.Smoke tests pass against the production API URL
```

### Acceptance criteria

- [x] `Production` GitHub environment exists with `AWS_*` secrets configured
- [x] `deploy-production` job runs after `deploy` (Test) succeeds
- [x] `deploy-production` job does not run when `deploy` fails
- [x] Acceptance specs pass against the production API URL post-deploy
- [x] No E2E tests run against production

---

## Slice 7.8-B — Note screen keyboard focus

**Status:** Done

### Scenarios

```
Scenario: Title input receives focus when the note screen opens
  Given I navigate to a note
  When  the note detail has loaded
  Then  the title input has focus

Scenario: Tab from title moves focus to the content area
  Given the note screen is open and the title input has focus
  When  I press Tab once
  Then  the content area has focus

Scenario: Tab order skips to content directly from title
  Given the note screen has a date input between the title and content
  When  I press Tab once from the title input
  Then  focus moves to the content area, not the date input
```

### Acceptance criteria

- [x] Title input has focus immediately after note detail loads (no click needed)
- [x] Single Tab from title moves focus to content
- [x] Date input and other controls are still reachable via Tab after content
- [x] Component tests cover focus-on-load and Tab behaviour

---

## Slice 7.8-C — Note screen save/cancel

**Status:** Done

### Scenarios

```
Scenario: Save is disabled on an empty new note
  Given a note with no title, no content, no tags, and no actions
  When  the note screen renders
  Then  the Save button is disabled

Scenario: Save enables when a title is entered
  Given a note with no content, no tags, and no actions
  When  I type a title
  Then  the Save button is enabled

Scenario: Save enables when content is entered
  Given a note with no title, no tags, and no actions
  When  I type content
  Then  the Save button is enabled

Scenario: Save enables when a tag is added
  Given a note with no title, no content, and no actions
  When  I add a tag
  Then  the Save button is enabled

Scenario: Save enables when an action is added
  Given a note with no title, no content, and no tags
  When  I add an action item
  Then  the Save button is enabled

Scenario: Save navigates back to the note list
  Given the Save button is enabled
  When  I click Save
  Then  I am taken back to the note list

Scenario: Cancel on an empty note navigates back immediately
  Given a note with no title, no content, no tags, and no actions
  When  I click Cancel
  Then  I am taken back to the note list without a confirmation dialog

Scenario: Cancel on a note with content shows a confirmation dialog
  Given a note with a title entered
  When  I click Cancel
  Then  a confirmation dialog appears asking "Discard this note?"

Scenario: Confirming cancel navigates back
  Given the cancel confirmation dialog is showing
  When  I click Confirm
  Then  I am taken back to the note list

Scenario: Keeping editing dismisses the dialog
  Given the cancel confirmation dialog is showing
  When  I click Keep Editing
  Then  the dialog closes and I remain on the note screen
```

### Acceptance criteria

- [x] Save disabled when title, content, tags, and actions are all empty
- [x] Save enabled when any of title, content, tags, or actions is non-empty
- [x] Save navigates back via `onBack()`
- [x] Cancel on empty note navigates back without confirmation
- [x] Cancel on non-empty note shows confirmation dialog
- [x] Confirming cancel navigates back; "Keep Editing" dismisses dialog
- [x] Component tests cover all scenarios above

---

## Slice 7.8-D — Drag-and-drop notes into folder slide-out panel

**Status:** Done

### Scenarios

```
Scenario: Dragging a note card onto a folder panel moves the note
  Given a note card is shown on the home screen
  And   a folder's slide-out panel is open
  When  I drag the note card and drop it onto the panel
  Then  a move request is sent for that note and folder
  And   the note card disappears from its current view immediately (optimistic)
  And   the note appears in the folder panel

Scenario: A failed move reverts the optimistic update
  Given I dragged a note card onto a folder panel
  When  the move API call fails
  Then  the note card reappears in its original position
  And   the note is removed from the folder panel

Scenario: Dropping a note onto the folder it already belongs to does nothing
  Given a note is already in folder A
  And   folder A's panel is open
  When  I drop the note card onto folder A's panel
  Then  no API call is made

Scenario: Drop target folder panel shows a visual drop zone
  Given a note card is being dragged
  When  the card is dragged over an open folder panel
  Then  the panel shows a visual drop zone indicator
```

### Acceptance criteria

- [x] Note cards have `draggable` attribute set; `dragStart` writes `noteId` to `dataTransfer`
- [x] `FolderPreviewPanel` accepts drops; calls `moveNoteToFolder` on drop
- [x] Optimistic update: note disappears from source view and appears in panel immediately
- [x] Failed move reverts the optimistic update
- [x] Dropping onto the note's current folder is a no-op
- [x] Drop zone visual indicator shown during drag-over
- [x] Component tests cover drag, drop, optimistic update, and revert

---

## Slice 7.8-E — Layout space review

**Status:** Done

### Scenarios

```
Scenario: Home screen uses the full available width on a wide viewport
  Given the viewport is 1280px wide
  When  I view the home screen
  Then  note cards extend across the majority of the viewport
  And   there are no large blank margins on either side

Scenario: Note content panel fills available height
  Given I am on the note screen
  When  I look at the content editor
  Then  the editor extends to fill the available vertical space
  And   I do not need to scroll to find an empty area to type in

Scenario: Note right panel does not dominate the layout
  Given I am on the note screen on a 1280px viewport
  When  I look at the note layout
  Then  the content panel is visually larger than the right panel
  And   the right panel remains readable and usable

Scenario: Layout remains usable at 768px viewport width
  Given the viewport is 768px wide
  When  I view either screen
  Then  no content is cut off or inaccessible
```

### Acceptance criteria

- [ ] Prototype approved before CSS changes begin (skipped — interaction was unambiguous)
- [x] `.container` max-width increased or removed; home screen cards use available width
- [x] Note content panel grows to fill available vertical space (no fixed `min-height` that leaves blank space)
- [x] Note layout proportions give the content panel the majority of horizontal space
- [x] No regressions on existing component tests after CSS changes
- [x] Visually verified on 1280px and 768px viewport widths

---

## Slice 7.8-F — Optimistic card state sync

**Status:** Done

### Scenarios

```
Scenario: Note title updates on the home screen immediately after renaming
  Given I am on the note screen and rename a note to "Q3 Planning"
  When  I navigate back to the home screen
  Then  the note card shows "Q3 Planning" immediately
  And   no refetch is needed before the correct title appears

Scenario: Note disappears from source folder panel immediately on move
  Given folder A's preview panel is open showing note "Meeting Notes"
  And   I drag "Meeting Notes" to folder B's preview panel
  When  the drop completes
  Then  "Meeting Notes" is removed from folder A's panel immediately
  And   "Meeting Notes" appears in folder B's panel immediately

Scenario: A failed rename reverts the card title
  Given I rename a note to "New Title" and the API call fails
  When  the rename request returns an error
  Then  the note card reverts to the original title on the home screen

Scenario: Note appears in destination folder home screen immediately on move
  Given I am viewing folder B's home screen (notes filtered to folder B)
  And   I move note "Meeting Notes" into folder B
  When  the move completes
  Then  "Meeting Notes" appears in folder B's home screen immediately
  And   no navigation or refresh is needed

Scenario: A failed move reverts both panels
  Given a note was dragged from folder A to folder B and the API call fails
  When  the move request returns an error
  Then  the note reappears in folder A's panel
  And   the note is removed from folder B's panel
```

### Acceptance criteria

- [x] `cards` state lives in `App` (or a shared hook); `ListView` and `FolderPreviewPanel` receive it as a prop
- [x] Renaming a note updates the matching card's title in shared state immediately (before API response)
- [x] Moving a note removes it from the source panel's cards immediately (optimistic)
- [x] Moving a note adds it to the destination folder's cards immediately (optimistic)
- [x] The folder home screen (filtered card list) reflects the move without navigation or refresh
- [x] Failed rename and failed move both revert the optimistic update
- [x] Component tests for `ListView` and `FolderPreviewPanel` updated to use props rather than internal fetches
- [x] No new `getNoteCards()` calls added — one fetch in `App`, shared downward

---

## Slice 7.8-G — Domain event dispatcher

**Status:** Done

### Scenarios

```
Scenario: All projections are updated after a command is handled
  Given a note exists
  When  RenameNote is handled
  Then  the NoteTitleList projection reflects the new title
  And   the NoteDetail projection reflects the new title
  And   the NoteCardList projection reflects the new title

Scenario: A new projection handler can be added without changing NoteCommandHandler
  Given a new IDomainEventHandler is registered in Builder.cs
  When  any command is handled
  Then  the new handler receives the events
  And   NoteCommandHandler has not been modified

Scenario: Projection updates remain synchronous — read-after-write is consistent
  Given RenameNote is handled
  When  the HTTP response is returned
  Then  GET /notes/{id} already reflects the new title
  And   no eventual-consistency delay is observable
```

### Acceptance criteria

- [x] `IDomainEventDispatcher` and `IDomainEventHandler` interfaces exist in `src/Api/`
- [x] Five event handler classes extracted; each handles only its own projection's stores
- [x] `NoteCommandHandler` constructor takes only `IEventStore` and `IDomainEventDispatcher`
- [x] `UpdateProjectionAsync` and `ApplyNoteEventsToCard` removed from `NoteCommandHandler`
- [x] All existing `Api.Integration` tests pass unchanged (behaviour is identical)
- [x] `Domain.Specs` tests pass unchanged
- [x] `cdk synth` exits 0

---

## Slice 7.8-H — Human-readable URLs

**Status:** Done

### Scenarios

```
Scenario: The app is reachable at the custom domain in Test
  Given the Test environment is deployed with DOMAIN_NAME=notes-test.example.com
  When  I navigate to https://notes-test.example.com
  Then  the app loads correctly

Scenario: The app is reachable at the custom domain in Production
  Given the Production environment is deployed with DOMAIN_NAME=notes.example.com
  When  I navigate to https://notes.example.com
  Then  the app loads correctly

Scenario: API calls use relative paths — no VITE_API_URL needed at build time
  Given the frontend bundle is built without VITE_API_URL
  When  the app makes an API call
  Then  the request goes to /api/notes (relative)
  And   CloudFront proxies it to API Gateway

Scenario: CDK synth without a domain name produces no certificate or alias record
  Given DomainName is not set in the CDK context
  When  cdk synth runs
  Then  no ACM certificate resource is in the template
  And   the CloudFront distribution uses only its default domain
```

### Acceptance criteria

- [x] Prerequisites met: domain owned, Route 53 hosted zone created, `DOMAIN_NAME` + `HOSTED_ZONE_ID` secrets added to both GitHub environments
- [x] CDK stack creates ACM certificate and CloudFront alias when `DomainName` is set; skips both when unset
- [x] CloudFront `/api/*` behaviour strips prefix and forwards to API Gateway
- [x] `web/src/api.ts` uses relative `/api` base path; `VITE_API_URL` removed from codebase
- [x] `deploy.yml` no longer passes `VITE_API_URL` to the frontend build
- [x] App reachable at CloudFront URL for Test; custom domain active in Production when secrets configured
- [x] `InfraAssertions` tests cover cert, alias, and `/api` behaviour presence
- [x] `cdk synth` (no domain) exits 0 with no cert or alias record in template
- [x] CloudFront proxy backlog item closed

---

## Slice 7.8-I — Read-only smoke suite

**Status:** Done

### Scenarios

```
Scenario: Smoke suite makes no write calls
  Given the smoke suite runs against a deployed environment
  When  all specs complete
  Then  no notes, folders, or action items have been created in the database

Scenario: Read endpoints return correct shapes
  Given the deployed API has real data
  When  GET /notes is called
  Then  the response is 200 with an "items" array

Scenario: 404 path works for non-existent note
  Given a random note ID that does not exist
  When  PATCH /notes/{id}/title is called
  Then  the response is 404
```

### Acceptance criteria

- [x] `ReadEndpointsSpec.cs` and `ErrorResponsesSpec.cs` added; no `PostAsync("notes", ...)` anywhere in the suite
- [x] All 10 write-heavy spec files deleted
- [x] `dotnet test tests/Api.Smoke/Api.Smoke.csproj` exits 0 (against deployed Test environment)
- [x] No new notes appear in the deployed database after the suite runs
