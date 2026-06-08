# Phase 5 — Tags and Folders

**Goal:** Let users label notes with tags and organise them into folders. Tags give notes searchable metadata; folders give them a home. This phase introduces the `TagIndex` projection, the `Folder` aggregate, the `FolderTree` projection, and wires all of them to the frontend.

## Summary

| Slice | Summary | Status | Depends on |
|-------|---------|--------|------------|
| 5-A | Add tags to a note | Done | — |
| 5-B | Remove a tag from a note | Done | 5-A |
| 5-C | Tag filter bar | Done | 5-A |
| 5-D | Create and browse folders | Done | — |
| 5-E | Rename a folder | Done | 5-D |
| 5-F | Delete an empty folder | Done | 5-D |
| 5-G | File a note in a folder | Done | 5-D |
| 5-H | Unfiled Notes view | Done | 5-G |
| 5-I | Folder preview panel | Done | 5-G |
| 5-J | Auto-assign note to current folder | Done | 5-G |
| 5-K | Reparent a folder | Done | 5-D |
| 5-L | Cascade delete a folder | Done | 5-F, 5-G |
| 5-M | Note date defaults to today | Done | — |
| 5-N | Folder navigation component tests | Done | 5-D |

Each slice is a complete vertical: domain events, API endpoints, projections, and the frontend wired to those endpoints. 5-B and 5-C are parallel once 5-A lands. 5-E, 5-F, and 5-K are parallel once 5-D lands. 5-H, 5-I, and 5-J are parallel once 5-G lands.

---

## Slice 5-A — Add tags to a note

**Status:** Done

### Scenarios

```
Scenario: Add a tag to a note
  Given I have a note open
  When  I type "1:1s" in the tag input and press Enter
  Then  a "1:1s" pill appears in the tags section
  And   the tag is still there when I close and reopen the note

Scenario: Add multiple tags at once by separating with spaces
  Given I have a note open
  When  I type "1:1s Bill" in the tag input and press Enter
  Then  two tag pills appear: "1:1s" and "Bill"

Scenario: Adding a tag that already exists has no effect
  Given a note already has the tag "1:1s"
  When  I type "1:1s" in the tag input and press Enter
  Then  no second "1:1s" pill appears and no error is shown

Scenario: Tags appear as pills on the home screen note card
  Given I have added tags "1:1s" and "Bill" to a note
  When  I return to the home screen
  Then  the note card shows pills for "1:1s" and "Bill"

Scenario: A note with no tags shows no tag pills on its card
  Given I have a note with no tags
  When  I view the home screen
  Then  no tag pills appear on that note's card
```

### Acceptance criteria

- [ ] *(internal)* `Note` aggregate tracks `_tags`; `TagNote` on a present tag returns 409; no event appended on duplicate
- [ ] *(internal)* `NoteTagged` is deserialised and routed
- [ ] *(internal)* `NoteDetail` and `NoteCardList` projections fold `NoteTagged`
- [ ] `POST /notes/{noteId}/tags` stores the tag; `GET /notes/{noteId}` returns it in the tags list
- [ ] `POST` with duplicate tag returns 409
- [ ] `GET /notes/cards` response includes `"tags": [...]` for each card
- [ ] Tags section on the note screen loads from `GET /notes/{noteId}` and renders as pills
- [ ] Adding a tag via the input calls the real API
- [ ] Duplicate tag from the UI is handled silently (409 swallowed)
- [ ] Tag pills visible on home screen note cards; no tag area when `tags` is empty
- [ ] E2E: create note, add tags "1:1s Bill" on note screen; navigate home — two pills on card; open note again — pills still there

---

## Slice 5-B — Remove a tag from a note

**Status:** Done

### Scenarios

```
Scenario: Remove a tag using the × button
  Given a note has tags "1:1s" and "Bill"
  When  I click × on the "Bill" pill
  Then  the "Bill" pill disappears
  And   only "1:1s" is shown when I close and reopen the note

Scenario: The removed tag no longer appears on the home screen card
  Given I removed "Bill" from a note that had "1:1s" and "Bill"
  When  I return to the home screen
  Then  only "1:1s" appears on that note's card

Scenario: Trying to remove a tag that does not exist returns an error
  Given a note does not have the tag "missing"
  When  DELETE /notes/{id}/tags/missing is called
  Then  404 is returned
```

### Acceptance criteria

- [ ] *(internal)* `UntagNote` on a missing tag returns an error; no event appended
- [ ] *(internal)* `NoteUntagged` is deserialised and routed
- [ ] *(internal)* `NoteDetail` and `NoteCardList` projections fold `NoteUntagged`
- [ ] `DELETE /notes/{noteId}/tags/{tag}` removes the tag; `GET /notes/{noteId}` no longer returns it
- [ ] `DELETE` on a tag that is not present returns 404
- [ ] Clicking × on a pill calls the real delete endpoint; pill disappears immediately
- [ ] Home screen card no longer shows the removed tag
- [ ] E2E: add tags "1:1s Bill" to a note; click × on "Bill"; navigate home — only "1:1s" on card; open note — only "1:1s" pill

---

## Slice 5-C — Tag filter bar

**Status:** Done

### Scenarios

```
Scenario: Tags I have used appear in the filter bar
  Given I have tagged notes with "1:1s" and "Bill"
  When  I view the home screen
  Then  a filter bar shows pills for "1:1s" and "Bill"

Scenario: A tag used on multiple notes appears once in the filter bar
  Given two notes are both tagged "1:1s"
  When  I view the home screen
  Then  "1:1s" appears once in the filter bar

Scenario: Tags used on more notes appear first
  Given "rare" is on 1 note and "common" is on 5 notes
  When  I view the home screen
  Then  "common" appears before "rare" in the filter bar

Scenario: Removing a tag from its only note removes it from the filter bar
  Given only one note is tagged "rare"
  When  I remove the tag "rare" from that note
  Then  "rare" no longer appears in the filter bar

Scenario: Deleting a note removes its unique tags from the filter bar
  Given a note is the only one tagged "gone"
  When  I delete that note
  Then  "gone" no longer appears in the filter bar

Scenario: Clicking a tag pill filters the note list
  Given two notes: one tagged "1:1s", one tagged "Bill"
  When  I click "1:1s" in the filter bar
  Then  only the note tagged "1:1s" is shown

Scenario: Clicking an active tag pill deselects it and shows all notes
  Given I have filtered by "1:1s"
  When  I click "1:1s" again
  Then  all notes are shown

Scenario: Selecting two tags in AND mode shows notes with both
  Given a note tagged "1:1s" and "Bill", and a note tagged only "1:1s"
  When  I select "1:1s" and "Bill" with AND mode active
  Then  only the note with both tags is shown

Scenario: Selecting two tags in OR mode shows notes with either
  Given a note tagged "1:1s" and a note tagged "Bill"
  When  I select both with OR mode active
  Then  both notes are shown

Scenario: Clearing the filter shows all notes and resets the mode to AND
  Given I have filtered by "1:1s" in OR mode
  When  I click Clear
  Then  all notes are shown and the toggle resets to AND
```

### Acceptance criteria

- [ ] *(internal)* `TagIndex` projection folds `NoteTagged` (put), `NoteUntagged` (delete row), `NoteDeleted` (delete all rows for note)
- [ ] *(internal)* CDK template includes `notetaker-proj-tagindex` with composite key `(Tag, NoteId)`
- [ ] `GET /tags` returns tags with `noteCount` and `noteIds`; ordered by count descending
- [ ] Filter bar appears on home screen when tags exist; hidden when no tags
- [ ] Filter bar populated from `GET /tags` (not derived from card data)
- [ ] Clicking a tag pill filters cards to matching notes; clicking again deselects
- [ ] AND/OR toggle visible when ≥2 tags selected; default AND
- [ ] AND mode shows only notes with all selected tags; OR mode shows notes with any
- [ ] Clear button resets selected tags and mode
- [ ] E2E: tag two notes differently; click one tag — only matching card shown; select both in OR mode — both shown; clear — all shown

---

## Slice 5-D — Create and browse folders

**Status:** Done

### Scenarios

```
Scenario: Create a root folder
  Given I open the sidebar
  When  I click + in the Folders section, type "People", and confirm
  Then  "People" appears in the sidebar folder list

Scenario: Create a subfolder
  Given folder "People" exists in the sidebar
  When  I hover over "People", click + to add a subfolder, type "Bill", and confirm
  Then  "Bill" appears nested under "People" in the sidebar

Scenario: My folders are shown when I open the app
  Given I created folders "People" and "Projects" in a previous session
  When  I open the app
  Then  "People" and "Projects" appear in the sidebar

Scenario: Clicking a folder navigates to its view
  Given folder "People" exists in the sidebar
  When  I click "People"
  Then  the main area shows "People" as the heading

Scenario: The todo list is hidden when viewing a folder
  Given I click any folder in the sidebar
  When  the folder view loads
  Then  the todo list is not shown

Scenario: Clicking Home returns to the home view with the todo list
  Given I am viewing a folder
  When  I click Home in the sidebar
  Then  all notes are shown and the todo list is visible
```

### Acceptance criteria

- [ ] *(internal)* `Folder` aggregate folds `FolderCreated`; empty name throws
- [ ] *(internal)* `FolderTree` projection folds `FolderCreated` correctly
- [ ] *(internal)* CDK template includes `notetaker-proj-foldertree` table
- [ ] `POST /folders` creates a folder; `GET /folders` returns it in the nested tree
- [ ] `POST /folders` with `parentFolderId` creates a nested folder under the parent
- [ ] Sidebar loads folder tree from `GET /folders` on app mount (replaces `localStorage` init)
- [ ] Home button navigates to home list view
- [ ] Clicking a folder name navigates to that folder's view; main area shows the folder heading
- [ ] Todo section hidden in all folder views; visible only on home
- [ ] "← Save" button on note screen (not "← Back")
- [ ] E2E: create folders "People" and child "Bill"; sidebar shows tree; click "Bill" — main area shows "Bill"; click Home — home view with todo list

---

## Slice 5-E — Rename a folder

**Status:** Done

### Scenarios

```
Scenario: Rename a folder by double-clicking
  Given folder "Peopl" exists in the sidebar
  When  I double-click "Peopl", change the text to "People", and press Enter
  Then  the folder shows the corrected name "People"

Scenario: Rename persists after reopening the app
  Given I renamed "Peopl" to "People"
  When  I reload the page
  Then  "People" still appears in the sidebar

Scenario: Pressing Escape while renaming cancels the change
  Given I have double-clicked a folder to rename it
  When  I press Escape
  Then  the folder name is unchanged
```

### Acceptance criteria

- [x] *(internal)* `RenameFolder` with empty name throws; `FolderRenamed` appended on success
- [x] *(internal)* `FolderTree` projection updates `Name` on `FolderRenamed`
- [x] `PATCH /folders/{folderId}/name` renames the folder; `GET /folders` reflects the new name
- [x] Double-clicking a folder name opens an inline text input pre-filled with the current name
- [x] ✎ hover button also opens the rename input
- [x] Confirming with Enter calls `PATCH` and updates the sidebar
- [x] Pressing Escape cancels without making a change
- [ ] E2E: create folder "Peopl"; double-click; rename to "People"; sidebar shows "People"; reload — still "People" _(E2E tests superseded by component tests in Phase 6.5)_

---

## Slice 5-F — Delete an empty folder

**Status:** Done (superseded by 5-L cascade delete — `DeleteFolder` cascades rather than returning 409)

### Scenarios

```
Scenario: Delete an empty folder
  Given folder "People" has no subfolders
  When  I click × on "People"
  Then  "People" disappears from the sidebar

Scenario: Cannot delete a folder that has subfolders
  Given folder "People" has a subfolder "Bill"
  When  I try to delete "People"
  Then  "People" remains in the sidebar

Scenario: Deleting the active folder navigates home
  Given I am viewing folder "People" and it has no subfolders
  When  I delete "People"
  Then  the home view is shown
```

### Acceptance criteria

- [x] *(internal)* `FolderDeleted` appended; `FolderTree` projection removes the row
- [x] *(internal)* `FolderTree` projection removes the row on `FolderDeleted`
- [x] `DELETE /folders/{folderId}` returns 204; folder gone from `GET /folders`
- [x] × hover button calls delete; folder disappears from sidebar on success
- [x] If the deleted folder was active, the app navigates home
- [ ] `DELETE /folders/{folderId}` on folder with children returns 409 _(changed: now cascades — see 5-L)_
- [ ] E2E _(superseded by component tests in Phase 6.5)_

---

## Slice 5-G — File a note in a folder

**Status:** Done

### Scenarios

```
Scenario: Drag a note into a folder
  Given I have an unfiled note and a folder "Projects" in the sidebar
  When  I drag the note card onto "Projects"
  Then  the note disappears from the home view
  And   it appears when I click "Projects" in the sidebar

Scenario: Folder view shows only notes filed in that folder
  Given one note is in folder "Bill" and another is unfiled
  When  I click "Bill" in the sidebar
  Then  only the note in "Bill" is shown

Scenario: Filing a note in a different folder moves it
  Given a note is already filed under "People"
  When  I drag it onto "Projects"
  Then  the note appears under "Projects" and is no longer under "People"
```

### Acceptance criteria

- [x] *(internal)* `Note` aggregate handles `MoveNoteToFolder`; fires `NoteFiledInFolder`
- [x] *(internal)* `NoteCardList` projection folds `NoteFiledInFolder` (sets `FolderId`)
- [x] `PUT /notes/{noteId}/folder` files a note; `GET /notes/cards` returns it with `folderId` set
- [x] `GET /notes/cards` includes `folderId: string | null` on every card
- [x] Dragging a note card onto a sidebar folder calls `PUT /notes/{id}/folder`
- [x] Folder view shows only cards where `card.folderId === activeFolderId`
- [x] Home view continues to show all notes regardless of `folderId`
- [x] `noteFolderMap` removed from `localStorage` and `App.tsx` state
- [ ] E2E _(superseded by component tests in Phase 6.5)_

---

## Slice 5-H — Unfiled Notes view

**Status:** Done

### Scenarios

```
Scenario: Unfiled Notes shows only notes not in any folder
  Given one note is in folder "Projects" and another has no folder
  When  I click "Unfiled Notes" in the sidebar
  Then  only the note with no folder is shown

Scenario: Drag a note onto "Unfiled Notes" removes its folder
  Given a note is filed under "People"
  When  I drag the note onto "Unfiled Notes" in the sidebar
  Then  the note appears in the Unfiled Notes view
  And   it is no longer shown when I click "People"

Scenario: All notes appear in Unfiled Notes after losing their folder
  Given I have two notes, both in folder "People", and I delete "People"
  When  I click "Unfiled Notes"
  Then  both notes are shown there
```

### Acceptance criteria

- [x] *(internal)* `Note` aggregate handles `UnfileNote`; fires `NoteUnfiled`
- [x] *(internal)* `NoteCardList` projection folds `NoteUnfiled` (clears `FolderId`)
- [x] `DELETE /notes/{noteId}/folder` unfiles the note; `GET /notes/cards` returns it with `folderId: null`
- [x] "Unfiled Notes" sidebar item is always visible and clickable; highlights when active
- [x] Clicking "Unfiled Notes" shows only cards where `card.folderId` is null
- [x] Dragging a note onto "Unfiled Notes" calls `DELETE /notes/{id}/folder`
- [ ] E2E _(superseded by component tests in Phase 6.5)_

---

## Slice 5-I — Folder preview panel

**Status:** Done

### Scenarios

```
Scenario: Open the preview panel with the » button
  Given folder "Bill" contains two notes and I can see "Bill" in the sidebar
  When  I hover over "Bill" and click »
  Then  a panel slides in showing the two note titles and their dates

Scenario: Switching to a different folder's preview updates the panel
  Given the preview panel is open for "Bill"
  When  I click » on "People"
  Then  the panel header changes to "People" and shows People's notes

Scenario: Closing the panel hides it
  Given the preview panel is open
  When  I click × on the panel
  Then  the panel slides out and the main content expands
```

### Acceptance criteria

- [x] `»` button visible on hover for each folder node
- [x] Clicking `»` opens the panel with the correct folder's notes (titles and dates)
- [x] Notes in the panel are draggable (can be dropped onto other folders)
- [x] Clicking `»` on a different folder updates the panel header and note list
- [x] `×` closes the panel
- [ ] E2E _(superseded by component tests in Phase 6.5)_

---

## Slice 5-J — Auto-assign note to current folder

**Status:** Done

### Scenarios

```
Scenario: A new note created from a folder view is auto-filed there
  Given I am viewing folder "Projects"
  When  I click "+ New Note"
  Then  the new note immediately appears under "Projects" when I return to the folder view

Scenario: A new note created from home is not filed anywhere
  Given I am on the home view
  When  I click "+ New Note"
  Then  the new note appears in "Unfiled Notes" and not under any folder

Scenario: A new note created from "Unfiled Notes" is not auto-filed
  Given I am viewing "Unfiled Notes"
  When  I click "+ New Note"
  Then  the new note appears in "Unfiled Notes"
```

### Acceptance criteria

- [x] Creating a note from a folder view (not home, not Unfiled Notes) fires `PUT /notes/{id}/folder` immediately after creation
- [x] The new note appears in the current folder when the user returns to it
- [x] Creating a note from home or Unfiled Notes does not file it anywhere
- [ ] E2E _(superseded by component tests in Phase 6.5)_

---

## Slice 5-K — Reparent a folder

**Status:** Done

### Scenarios

```
Scenario: Drag a folder onto another to reparent it
  Given "Bill" is at the root level and "People" exists
  When  I drag "Bill" onto "People"
  Then  "Bill" appears nested under "People" and is no longer at root

Scenario: Drag a folder to the root level
  Given "Bill" is a subfolder of "People"
  When  I drag "Bill" to the root area of the folder list
  Then  "Bill" appears at the root level alongside "People"

Scenario: Dragging a folder into one of its own descendants does nothing
  Given folder "People" has a subfolder "Bill"
  When  I try to drag "People" onto "Bill"
  Then  the folder tree is unchanged
```

### Acceptance criteria

- [x] *(internal)* `MoveFolder` appends `FolderMoved`; cycle detection rejects moves into own descendants (400)
- [x] *(internal)* `FolderTree` projection updates `ParentFolderId` on `FolderMoved`
- [x] `PUT /folders/{folderId}/parent` reparents the folder; `GET /folders` reflects new tree
- [x] `PUT /folders/{folderId}/parent` with a cycle returns 400
- [x] Drag folder onto folder in sidebar reparents it
- [x] Dragging to root (null parent) moves folder to root level
- [x] Notes inside moved folders are unaffected
- [ ] E2E _(superseded by component tests in Phase 6.5)_

---

## Slice 5-L — Cascade delete a folder

**Status:** Done

### Scenarios

```
Scenario: Delete a folder that has subfolders removes everything
  Given folder "People" has subfolder "Bill"
  When  I delete "People"
  Then  both "People" and "Bill" disappear from the sidebar

Scenario: Notes in a deleted folder's subtree appear in Unfiled Notes
  Given a note is filed in subfolder "Bill" under "People"
  When  I delete "People"
  Then  the note appears in Unfiled Notes

Scenario: Other folders and their notes are not affected
  Given folders "People" (with "Bill") and "Projects" exist, with notes in both
  When  I delete "People"
  Then  "Projects" and its notes are unchanged
```

### Acceptance criteria

- [x] *(internal)* `DeleteFolder` with descendants: unfiles all notes in subtree (`NoteUnfiled` per note), deletes descendant folders bottom-up (`FolderDeleted`), then deletes target; all correct events appended
- [x] `DELETE /folders/{folderId}` on folder with children cascades cleanly (no more 409)
- [x] All descendant folders disappear from `GET /folders`
- [x] All notes that were in the subtree appear in `GET /notes/cards` with `folderId: null`
- [ ] E2E _(superseded by component tests in Phase 6.5)_

---

## Slice 5-M — Note date defaults to today

**Status:** Done

### Scenarios

```
Scenario: A new note is pre-dated to today
  Given I click "+ New Note"
  When  the note screen opens
  Then  the date input shows today's date

Scenario: The date input has no formatted label beside it
  Given I am on any note screen
  When  I look at the date area
  Then  I see only the date input — no "dd/mm/yyyy" text label alongside it

Scenario: The pre-set date persists after navigating away and back
  Given I created a note (date defaulted to today)
  When  I go back to the home screen and open the note again
  Then  the date input still shows today's date

Scenario: I can change the date and it persists
  Given I am on a note screen with today's date pre-filled
  When  I change the date to a different day
  Then  the note screen shows the new date after I leave and return
```

### Acceptance criteria

- [ ] Creating a note fires `PATCH /notes/{noteId}/date` with today's ISO date immediately after creation; `GET /notes/{noteId}` returns `date = today`
- [ ] `NoteView` renders only `<input type="date">` in the date area — no `<span>` showing a formatted label
- [ ] `formatDateDisplay` is removed from `NoteView.tsx`
- [ ] Date input is pre-filled with today on a freshly created note
- [ ] Changing the date calls `PATCH /notes/{noteId}/date`; the updated date survives a page reload
- [ ] E2E: create a note — date input shows today; navigate home; reopen — date still shows today; change date — new date persists

---

## Slice 5-N — Folder navigation component tests

**Status:** Done

### Scenarios

```
Scenario: Clicking a folder shows its heading
  Given GET /folders returns folder { folderId: "f-1", name: "People" }
  When  the user clicks "People" in the sidebar
  Then  a heading "People" is visible in the main content area

Scenario: Clicking Home after a folder returns to the home heading
  Given the user has navigated into folder "People"
  When  the user clicks the Home button
  Then  the heading shows "Home"

Scenario: The todo list is hidden in folder view
  Given the user has clicked into folder "People"
  When  the folder view renders
  Then  data-testid="todo-section" is absent from the document

Scenario: The todo list is visible on the home view
  Given the App renders at the default home view
  When  the home view is shown
  Then  data-testid="todo-section" is present in the document

Scenario: Unfiled Notes is always visible in the sidebar
  Given the App renders with no folders
  When  the sidebar is shown
  Then  data-testid="unfiled-notes-button" is present in the document
```

### Acceptance criteria

- [ ] `web/src/__tests__/FolderNavigation.test.tsx` contains all 5 component tests; `npm run test` exits 0
- [ ] No test imports a real API URL or requires a deployed backend
- [ ] MSW handlers cover `GET /folders`, `GET /notes`, `GET /notes/cards` for every test
- [ ] Each test asserts on visible output or DOM presence, not component state
- [ ] The 5 tests are deleted from `FolderNavigationJourney.cs`; `CreateFolder_AppearsInSidebar` and `CreateSubfolder_AppearsNested` remain
- [ ] `dotnet build tests/Browser.E2E/Browser.E2E.csproj` exits 0 after deletions
- [ ] `AppPage.cs` compiles with no references to selectors used only by the removed tests
