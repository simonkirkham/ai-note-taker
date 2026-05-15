# Phase 7.8 — Production Pipeline and Note Screen UX

**Goal:** Establish a production deployment target and sharpen the note-screen interaction model with explicit lifecycle controls, keyboard-first focus, and drag-and-drop note filing.

**Learning surface:** Multi-environment GitHub Actions pipeline with environment-scoped secrets and sequential promotion; React controlled form patterns and dirty-state detection across multiple fields; focus management with `useRef` and `tabIndex`; HTML5 drag-and-drop API in React; optimistic UI for move operations.

---

## Slice order and dependencies

```
7.8-A  Production pipeline ──────────────────── CI/CD only (manual AWS + GitHub setup)
7.8-B  Note screen focus ────────────────────── frontend only; independent
7.8-C  Note screen save/cancel ──────────────── frontend only; independent of 7.8-B
7.8-D  Drag-and-drop into folder panel ─────── frontend only; independent
```

All slices are independent and can run in any order. 7.8-B and 7.8-C both touch `NoteView.tsx` so should not run in parallel.

---

## Slice 7.8-A — Production deployment pipeline

**Status:** Not Started

**Value:** Every merge to main automatically promotes through Test and then deploys to a production environment, giving confidence that what works in Test ships to users.

**What is already in place:**
- `deploy.yml` has a `deploy-production` job that `needs: deploy` (Test) and uses `environment: Production`
- The job uses the same CDK stack with production-scoped `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, and `AWS_REGION` secrets
- Smoke tests run against production; E2E tests are excluded (no data mutation in production)

**What is not yet in place:**
- `Production` GitHub environment has not been created in repo Settings → Environments
- Production AWS account credentials have not been added as environment secrets
- A production AWS account or IAM user for deployment has not been provisioned

**Manual setup steps (not a code slice — done by the developer):**
1. Create a GCP-free production AWS account (or use a separate IAM user with least-privilege deploy permissions in a dedicated region).
2. In GitHub repo Settings → Environments → New environment: name it `Production`.
3. Add `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION` as environment secrets for `Production`.
4. Optionally add a required reviewer to the `Production` environment for a manual approval gate before production deploys.

**Scenarios:**

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

**Acceptance criteria:**

- [ ] `Production` GitHub environment exists with `AWS_*` secrets configured
- [ ] `deploy-production` job runs after `deploy` (Test) succeeds
- [ ] `deploy-production` job does not run when `deploy` fails
- [ ] Acceptance specs pass against the production API URL post-deploy
- [ ] No E2E tests run against production

---

## Slice 7.8-B — Note screen keyboard focus

**Status:** Not Started

**Value:** Opening a note is keyboard-ready immediately — the cursor is in the title so I can start typing or rename without clicking. A single Tab moves focus to the content area so I can write without reaching for the mouse.

**What is already in place:**
- `NoteView.tsx` already calls `inputRef.current?.focus()` after the detail load resolves — cursor-in-title may already work
- The title is an `<input>` and the content is a `<textarea>` or editor element

**What needs verifying / changing:**
- Confirm `inputRef` is attached to the title `<input>` (not the date or another input)
- Confirm that Tab from the title input moves focus to the content area and not to an intervening control (date picker, etc.)
- If intervening controls interrupt the Tab flow, use `tabIndex` ordering to enforce `title → content`
- All other controls (date, tags, action input) remain in natural tab order after content

**Changes in scope:**
- `web/src/components/NoteView.tsx` — verify `inputRef` on title; add `tabIndex` if needed to ensure title → content tab order
- `web/src/__tests__/NoteView.test.tsx` — add: "title input is focused on load"; "pressing Tab from title moves focus to content"

**Scenarios:**

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

**Acceptance criteria:**

- [ ] Title input has focus immediately after note detail loads (no click needed)
- [ ] Single Tab from title moves focus to content
- [ ] Date input and other controls are still reachable via Tab after content
- [ ] Component tests cover focus-on-load and Tab behaviour

---

## Slice 7.8-C — Note screen save/cancel

**Status:** Not Started

**Value:** New notes have an explicit lifecycle — Save confirms the note is worth keeping; Cancel abandons it cleanly. This prevents empty or accidental notes building up in the list, and gives users a clear escape hatch on a note they didn't mean to create.

**Interaction model:**

- Save and Cancel buttons are always visible on the note screen.
- **Save** is disabled when the note has no title, no content, no tags, and no actions.
- **Save** is enabled as soon as any of those fields is non-empty.
- Clicking **Save** navigates back to the note list (content is already auto-persisted on blur — Save is a "done" action).
- Clicking **Cancel** on a note with no title, content, tags, or actions navigates back immediately (no confirmation — nothing to lose).
- Clicking **Cancel** on a note with any content shows a confirmation dialog: "Discard this note?" with Confirm and Keep Editing options. Confirm navigates back.

**Note:** Auto-save on blur is preserved for content and title. Save/Cancel are navigation controls, not persistence controls. The note is already saved to the server as the user types; Save/Cancel determine whether to stay on the screen or leave.

**Changes in scope:**

- `web/src/components/NoteView.tsx` — add `isSaveEnabled` derived state (true if title, content, tags, or actions are non-empty); add Save and Cancel buttons; wire Cancel confirmation dialog; Save navigates via `onBack()`
- `web/src/components/NoteView.tsx` — track action count to include in `isSaveEnabled`; `ActionsSection` must surface action count to parent (or NoteView reads it from loaded detail)
- `web/src/__tests__/NoteView.test.tsx` — tests for all scenarios below

**Scenarios:**

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

**Acceptance criteria:**

- [ ] Save disabled when title, content, tags, and actions are all empty
- [ ] Save enabled when any of title, content, tags, or actions is non-empty
- [ ] Save navigates back via `onBack()`
- [ ] Cancel on empty note navigates back without confirmation
- [ ] Cancel on non-empty note shows confirmation dialog
- [ ] Confirming cancel navigates back; "Keep Editing" dismisses dialog
- [ ] Component tests cover all scenarios above

---

## Slice 7.8-D — Drag-and-drop notes into folder slide-out panel

**Status:** Not Started

**Value:** I can file a note into a folder by dragging the note card from the home screen and dropping it onto the folder's slide-out preview panel, without needing to navigate into the note screen to change its folder.

**What is already in place:**
- Folders have a `»` button that opens a `FolderPreviewPanel` slide-out showing the folder's notes
- `MoveNoteToFolder` command exists in the domain (`src/Domain/Notes/MoveNoteToFolder.cs`)
- `POST /notes/{noteId}/move` endpoint exists (or will be confirmed before implementation)
- Note cards (`NoteCard.tsx`) render on the home screen

**Interaction design:**
- Note cards are draggable (`draggable` attribute + `onDragStart`)
- The `FolderPreviewPanel` accepts drops (`onDragOver` + `onDrop`)
- On drop: call `POST /notes/{noteId}/move` with the target folder ID; optimistically remove the note card from the Unfiled / current folder view and add it to the folder panel's note list
- If the API call fails: revert the optimistic update and show an error
- A note already in the target folder: drop is a no-op (no API call)
- Dragging a note to the same folder it is already in: visual feedback that it's the current folder; drop does nothing

**Changes in scope:**

- `web/src/components/NoteCard.tsx` — add `draggable` attribute; `onDragStart` stores `noteId` in `dataTransfer`
- `web/src/components/FolderPreviewPanel.tsx` — add `onDragOver` (prevent default to allow drop); `onDrop` reads `noteId` from `dataTransfer`; calls move API; triggers optimistic state update
- `web/src/api.ts` — add `moveNoteToFolder(noteId, folderId)` → `POST /notes/{noteId}/move`
- `web/src/App.tsx` (or wherever folder/card state lives) — handle optimistic removal from current list and add to folder
- `web/src/__tests__/NoteCard.test.tsx` — add: "note card is draggable"; "dragStart sets noteId in dataTransfer"
- `web/src/__tests__/FolderPreviewPanel.test.tsx` — add: "drop calls moveNoteToFolder"; "optimistic update moves card"; "failed move reverts"

**Scenarios:**

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

**Acceptance criteria:**

- [ ] Note cards have `draggable` attribute set; `dragStart` writes `noteId` to `dataTransfer`
- [ ] `FolderPreviewPanel` accepts drops; calls `moveNoteToFolder` on drop
- [ ] Optimistic update: note disappears from source view and appears in panel immediately
- [ ] Failed move reverts the optimistic update
- [ ] Dropping onto the note's current folder is a no-op
- [ ] Drop zone visual indicator shown during drag-over
- [ ] Component tests cover drag, drop, optimistic update, and revert
