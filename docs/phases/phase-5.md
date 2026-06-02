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

**Learning surface:** A second projection axis over the existing event stream (`TagIndex`); a brand-new aggregate (`Folder`) with its own event stream; projection evolution (`NoteCardList` extended with `Tags` and `FolderId?`); client-side filter state against a server projection; hierarchical read models.

---

## Prototype status

A full frontend prototype was built before implementation began (branch `prototype/5-folders-tags-drag-drop`). The prototype validated the UX and is the source of truth for interaction design. Implementation rebuilds from scratch — the components below are guides, not code to copy.

**Prototype confirmed components (reference only):**
- `components/TagsSection.tsx` — tag pills + input on note screen
- `components/TagFilter.tsx` — filter bar with AND/OR toggle on home screen
- `components/NoteCard.tsx` — tag pills, draggable for folder assignment
- `components/FolderTree.tsx` — recursive sidebar tree with expand/collapse, rename, delete, add child, `»` preview button, drag-over drop target
- `components/FolderPreviewPanel.tsx` — slide-out panel showing notes + dates for a folder; notes are draggable
- `components/Sidebar.tsx` — Home button, Unfiled Notes drop target, folder tree, no note list
- `components/NoteView.tsx` — "← Save" back button, tags section, date defaults to today
- `App.tsx` — folder state in `localStorage` (`notetaker-folders`, `notetaker-note-folder-map`, `notetaker-note-date-map`); `UNFILED_ID = "__unfiled__"` sentinel; `handleMoveNoteToFolder`, `handleDateSet`; auto-assigns new note to active folder on create

**What real implementation must replace:**
- `localStorage` for folders, note→folder map, note→date map → replace with API calls + `card.folderId` / `card.date` from `GET /notes/cards` response
- Fire-and-forget API stubs (`.catch(() => {})`) → real error handling
- `noteFolderMap` local state → `card.folderId` from card response
- `noteDateMap` local state → `card.date` from card response

---

## What is already in place

Phase 4 already:
- Modelled `TagNote` / `UntagNote` commands and `NoteTagged` / `NoteUntagged` events in `docs/event-model.md` and `docs/event-schemas.md`
- Stored `Tags` as a string set in `NoteCardList` and `NoteDetail` projections
- Specified the `TagIndex` projection fully in `docs/view-schemas.md`
- Rendered tag areas as **empty placeholders** in Phase 4 (`NoteCard.tsx`, `NoteView.tsx`)

What is **not** yet in place:
- No `TagNote` / `UntagNote` command handlers in `src/Api/`
- No `NoteTagged` / `NoteUntagged` events in `src/Domain/Notes/NoteEvents.cs`
- `NoteCardList` and `NoteDetail` projections do not yet handle `NoteTagged` / `NoteUntagged`
- No `TagIndex` projection
- No `Folder` aggregate, events, commands, or command handler
- No `FolderTree` projection or DynamoDB table
- No `NoteFiledInFolder` / `NoteUnfiled` events on the `Note` aggregate
- All frontend API calls are fire-and-forget stubs — none are wired to real backend responses

---

## Slice 5-A — Add tags to a note

**Status:** Done

**Value:** I can add tags to a note so I can label what it's about — tags appear as pills on the note screen and on the note's home screen card.

**Commands in scope:**
- `TagNote(NoteId, Tag, TaggedAt)` — note exists, not deleted, tag not already present

**Events in scope:**
- `NoteTagged { NoteId, Tag }` — already specified in `docs/event-schemas.md`

**Projections in scope:**
- `NoteDetail` — extend to handle `NoteTagged` (add to Tags list)
- `NoteCardList` — add `NoteTagged` handler; include `tags: string[]` in card response

**API endpoints:**
- `POST /notes/{noteId}/tags` — body `{ "tag": "1:1s" }` (single tag per call); returns 204; 409 if tag already present

**Key implementation files:**
- `src/Domain/Notes/NoteCommands.cs` — add `TagNote`
- `src/Domain/Notes/NoteEvents.cs` — add `NoteTagged`
- `src/Domain/Notes/Note.cs` — add `_tags` set, `Apply(NoteTagged)`, `HandleTagNote`
- `src/EventStore/EventDeserializer.cs` — route `NoteTagged`
- `src/EventStore/Projections/NoteDetailProjection.cs` — add `NoteTagged` handler
- `src/EventStore/Projections/NoteCardListProjection.cs` — add `NoteTagged` handler; include `tags` in card DTO
- `src/Api/NoteCommandHandler.cs` — add `HandleAsync(TagNote)`
- `src/Api/Handlers/NoteHandlers.cs` — tag endpoint + `tags` in `GET /notes/cards` DTO
- `src/Api/Endpoints/NoteEndpoints.cs` — register `POST /notes/{noteId}/tags`
- `tests/Specs/Notes/TagNoteSpec.cs` — new BDD spec file
- `tests/ApiIntegration/` — extend in-memory stores to handle `NoteTagged`
- `web/src/components/TagsSection.tsx` — build fresh; renders tag pills (no × yet) + input; calls real API
- `web/src/components/NoteView.tsx` — load tags from `getNoteDetail()`; place `<TagsSection>` above `<ActionsSection>`
- `web/src/components/NoteCard.tsx` — render `card.tags` as pills; no pills when `tags` is empty
- `web/src/api.ts` — add `tagNote(noteId, tag)`; add `tags: string[]` to `NoteCard` and `NoteDetail` interfaces

**Note on multi-tag input:** The prototype accepted space-separated tags in a single input (e.g. `"1:1s Bill API"` → three tags). The API takes one tag per call. The frontend should split the input on spaces and fire one `POST` per tag.

**Batches:** Batch 1: domain BDD spec + API integration. Batch 2: E2E + frontend wire-up.

**Scenarios:**

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

**Acceptance criteria:**

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

**Value:** I can remove a tag I added by mistake or no longer need — clicking × on a pill removes it immediately.

**Commands in scope:**
- `UntagNote(NoteId, Tag, UntaggedAt)` — note exists, tag present

**Events in scope:**
- `NoteUntagged { NoteId, Tag }` — already specified in `docs/event-schemas.md`

**Projections in scope:**
- `NoteDetail` — extend to handle `NoteUntagged` (remove from Tags list)
- `NoteCardList` — add `NoteUntagged` handler

**API endpoints:**
- `DELETE /notes/{noteId}/tags/{tag}` — returns 204; 404 if tag not present

**Key implementation files:**
- `src/Domain/Notes/NoteCommands.cs` — add `UntagNote`
- `src/Domain/Notes/NoteEvents.cs` — add `NoteUntagged`
- `src/Domain/Notes/Note.cs` — add `Apply(NoteUntagged)`, `HandleUntagNote`
- `src/EventStore/EventDeserializer.cs` — route `NoteUntagged`
- `src/EventStore/Projections/NoteDetailProjection.cs` — add `NoteUntagged` handler
- `src/EventStore/Projections/NoteCardListProjection.cs` — add `NoteUntagged` handler
- `src/Api/NoteCommandHandler.cs` — add `HandleAsync(UntagNote)`
- `src/Api/Handlers/NoteHandlers.cs` — delete tag endpoint
- `src/Api/Endpoints/NoteEndpoints.cs` — register `DELETE /notes/{noteId}/tags/{tag}`
- `tests/Specs/Notes/UntagNoteSpec.cs` — new BDD spec file
- `tests/ApiIntegration/` — extend to handle `NoteUntagged`
- `web/src/components/TagsSection.tsx` — add × button to each pill; call `untagNote()` on click
- `web/src/api.ts` — add `untagNote(noteId, tag)`

**Scenarios:**

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

**Acceptance criteria:**

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

**Value:** I can see all the tags I've used in a filter bar and click one (or more) to show only the notes that match, then clear the filter to see everything again.

**Commands in scope:** none

**Events in scope:** `NoteTagged`, `NoteUntagged`, `NoteDeleted`

**Projections in scope:** `TagIndex` — fully specified in `docs/view-schemas.md`. Storage: table `notetaker-proj-tagindex` (PK: `Tag`, SK: `NoteId`).
- `NoteTagged` → put row `(Tag, NoteId, TaggedAt)`
- `NoteUntagged` → delete row
- `NoteDeleted` → delete all rows where `NoteId = …`

**API endpoint:** `GET /tags` — returns `{ "tags": [{ "tag": "1:1s", "noteCount": 3, "noteIds": [...] }] }` ordered by `noteCount` descending.

**CDK changes:** new table `notetaker-proj-tagindex` (PK: `Tag`, SK: `NoteId`); env var `PROJ_TAGINDEX_TABLE_NAME`; `GrantReadWriteData`.

**Frontend changes:**
- `TagFilter.tsx` — build fresh; receives `tags: TagIndexEntry[]`, `selectedTags: string[]`, `mode: "AND" | "OR"`, `onToggle`, `onModeChange`, `onClear`; active pills visually distinct; AND/OR toggle visible when ≥2 tags selected
- `ListView.tsx` — call `getTags()` on mount; hold `selectedTags` + `filterMode` state; filter `cards` before rendering; render `<TagFilter>` above the note grid; hide filter bar when no tags exist
- `api.ts` — add `getTags()` returning `TagIndexEntry[]`

**Key implementation files:**
- `src/EventStore/Projections/TagIndexProjection.cs` — new file
- `src/Api/Handlers/TagHandlers.cs` — new `GetTags` handler
- `src/Api/Endpoints/NoteEndpoints.cs` — register `GET /tags`
- `src/Infrastructure/NoteTakerStack.cs` — new CDK table + env var + IAM grant
- `tests/Specs/Projections/TagIndexProjectionSpec.cs` — new spec file
- `tests/ApiIntegration/InMemoryTagIndexStore.cs` — new in-memory implementation
- `tests/InfraAssertions/` — update CDK assertion for new table

**Batches:** Batch 1: projection spec + API integration + CDK assertions. Batch 2: E2E + frontend filter wire-up.

**Scenarios:**

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

**Acceptance criteria:**

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

**Value:** I can create folders in the sidebar and navigate between them — clicking a folder shows its dedicated view, and clicking Home returns to all my notes.

**Commands in scope:**
- `CreateFolder(FolderId, Name, ParentFolderId?)` — name must be non-empty

**Events in scope:**
- `FolderCreated { FolderId, Name, ParentFolderId? }`

**Projections in scope:** `FolderTree` — builds the full hierarchical structure. Storage: table `notetaker-proj-foldertree` (PK: `FolderId`). Each row: `FolderId`, `Name`, `ParentFolderId?`, `CreatedAt`.
- `FolderCreated` → put row

**API endpoints:**
- `POST /folders` — body `{ "name": "People", "parentFolderId": null }`; returns 201 with `{ "folderId": "..." }`
- `GET /folders` — returns the full folder tree as nested JSON

**CDK changes:** new table `notetaker-proj-foldertree` (PK: `FolderId`); env var `PROJ_FOLDERTREE_TABLE_NAME`; `GrantReadWriteData`.

**Sidebar UX (prototype confirmed):**
- **Home button** at the top — always visible; navigates to the home list view
- **"+ New Note" button** below Home
- **Folders section** below, containing:
  - **"Unfiled Notes"** — always-present special item; no rename/delete; click navigation only (active filing logic in 5-H)
  - **Folder tree** — recursive list of real folders with expand/collapse and click-to-navigate; hover shows `+` (add subfolder) only in this slice — rename (✎) and delete (×) come in 5-E and 5-F
  - **"New folder" inline input** — appears when + in the section header is clicked

**Folder navigation:** clicking a folder name sets the active folder view; the main content area shows a folder heading (no notes yet — notes appear in 5-G). Todo section is hidden in all folder views (including empty ones) and visible only on the home view.

**"← Save" button:** the back/save button on the note screen reads "← Save" (prototype confirmed, applies regardless of folder state).

**Key implementation files:**
- `src/Domain/Folders/` — new: `FolderCommands.cs`, `FolderEvents.cs`, `Folder.cs`
- `src/EventStore/EventDeserializer.cs` — route folder events
- `src/EventStore/Projections/FolderTreeProjection.cs` — new file
- `src/Api/FolderCommandHandler.cs` — new command handler
- `src/Api/Handlers/FolderHandlers.cs` — new HTTP handlers
- `src/Api/Endpoints/FolderEndpoints.cs` — register folder endpoints
- `src/Infrastructure/NoteTakerStack.cs` — new CDK table + env var + IAM grant
- `tests/Specs/Folders/CreateFolderSpec.cs` — new BDD spec file
- `tests/ApiIntegration/InMemoryFolderTreeStore.cs` — new in-memory implementation
- `tests/InfraAssertions/` — update CDK assertion for new table
- `web/src/App.tsx` — replace `localStorage` folder init with `getFolders()` on mount; `handleCreateFolder` calls POST and uses returned `folderId`; `currentFolderId` state; pass to sidebar
- `web/src/components/Sidebar.tsx` — build fresh; Home button, "Unfiled Notes" item, folder tree with + subfolder hover action, new folder inline input
- `web/src/components/FolderTree.tsx` — build fresh; recursive component with expand/collapse and + subfolder; no rename/delete yet
- `web/src/components/ListView.tsx` — show folder heading when `currentFolderId` is set; hide `<TodoSection>` when in any folder view

**Batches:** Batch 1: domain BDD spec + API integration + CDK assertions. Batch 2: E2E + frontend wire-up.

**Scenarios:**

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

**Acceptance criteria:**

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

**Value:** I can fix a folder name I got wrong — double-clicking it lets me type a new name in place.

**Commands in scope:**
- `RenameFolder(FolderId, NewName)` — folder exists, name non-empty

**Events in scope:**
- `FolderRenamed { FolderId, NewName }`

**Projections in scope:**
- `FolderTree` — add `FolderRenamed` handler (update Name)

**API endpoints:**
- `PATCH /folders/{folderId}/name` — body `{ "name": "..." }`; returns 200

**Key implementation files:**
- `src/Domain/Folders/FolderCommands.cs` — add `RenameFolder`
- `src/Domain/Folders/FolderEvents.cs` — add `FolderRenamed`
- `src/Domain/Folders/Folder.cs` — add `Apply(FolderRenamed)`, `HandleRenameFolder`
- `src/EventStore/EventDeserializer.cs` — route `FolderRenamed`
- `src/EventStore/Projections/FolderTreeProjection.cs` — add `FolderRenamed` handler
- `src/Api/FolderCommandHandler.cs` — add `HandleAsync(RenameFolder)`
- `src/Api/Handlers/FolderHandlers.cs` — add PATCH handler
- `src/Api/Endpoints/FolderEndpoints.cs` — register `PATCH /folders/{folderId}/name`
- `tests/Specs/Folders/RenameFolderSpec.cs` — new BDD spec file
- `web/src/components/FolderTree.tsx` — add double-click inline rename input; ✎ hover button; call `renameFolder()` on confirm
- `web/src/api.ts` — add `renameFolder(folderId, name)`

**Scenarios:**

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

**Acceptance criteria:**

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

**Value:** I can delete a folder I no longer need — as long as it has no subfolders.

**Commands in scope:**
- `DeleteFolder(FolderId)` — folder exists; returns 409 if folder has children (cascade handled in 5-L)

**Events in scope:**
- `FolderDeleted { FolderId }`

**Projections in scope:**
- `FolderTree` — add `FolderDeleted` handler (delete row)

**API endpoints:**
- `DELETE /folders/{folderId}` — returns 204 on empty folder; 409 if folder has children

**Key implementation files:**
- `src/Domain/Folders/FolderCommands.cs` — add `DeleteFolder`
- `src/Domain/Folders/FolderEvents.cs` — add `FolderDeleted`
- `src/Domain/Folders/Folder.cs` — add `Apply(FolderDeleted)`, `HandleDeleteFolder`
- `src/EventStore/EventDeserializer.cs` — route `FolderDeleted`
- `src/EventStore/Projections/FolderTreeProjection.cs` — add `FolderDeleted` handler
- `src/Api/FolderCommandHandler.cs` — add `HandleAsync(DeleteFolder)`; check children in projection before deleting
- `src/Api/Handlers/FolderHandlers.cs` — add DELETE handler
- `src/Api/Endpoints/FolderEndpoints.cs` — register `DELETE /folders/{folderId}`
- `tests/Specs/Folders/DeleteFolderSpec.cs` — new BDD spec file
- `web/src/components/FolderTree.tsx` — add × hover button; call `deleteFolder()` on click; navigate home if active folder is deleted
- `web/src/api.ts` — add `deleteFolder(folderId)`

**Scenarios:**

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

**Acceptance criteria:**

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

**Value:** I can drag a note into a folder to organise it — clicking the folder then shows only that folder's notes.

**Commands in scope:**
- `MoveNoteToFolder(NoteId, FolderId)` → `NoteFiledInFolder { NoteId, FolderId }`

**Events in scope:**
- `NoteFiledInFolder { NoteId, FolderId }` — new event on `Note` aggregate

**Projections in scope:**
- `NoteCardList` — extend with `FolderId?` field; add `NoteFiledInFolder` handler (set FolderId)

**API endpoints:**
- `PUT /notes/{noteId}/folder` — body `{ "folderId": "..." }`; returns 204; 404 if note or folder not found
- `GET /notes/cards` — each card now includes `folderId?: string`

**Drag UX (prototype confirmed):**
- Note cards use `dataTransfer.setData("text/plain", noteId)`
- Sidebar folder nodes accept `dragover` and `drop` events
- Dropping a note card onto a folder calls `PUT /notes/{id}/folder`
- Drag-over highlights the folder node with a teal outline

**Folder view filtering:** `ListView` filters `cards` by `card.folderId === currentFolderId` when a folder is active.

**Key implementation files:**
- `src/Domain/Notes/NoteCommands.cs` — add `MoveNoteToFolder`
- `src/Domain/Notes/NoteEvents.cs` — add `NoteFiledInFolder`
- `src/Domain/Notes/Note.cs` — add `_folderId` state; `Apply(NoteFiledInFolder)`; `HandleMoveNoteToFolder`
- `src/EventStore/EventDeserializer.cs` — route `NoteFiledInFolder`
- `src/EventStore/Projections/NoteCardListProjection.cs` — add `FolderId?` to `NoteCardView`; add `NoteFiledInFolder` handler
- `src/Api/NoteCommandHandler.cs` — add `HandleAsync(MoveNoteToFolder)`
- `src/Api/Handlers/NoteHandlers.cs` — add PUT handler; include `folderId` in card response
- `src/Api/Endpoints/NoteEndpoints.cs` — register `PUT /notes/{noteId}/folder`
- `tests/Specs/Notes/MoveNoteToFolderSpec.cs` — new BDD spec file
- `tests/ApiIntegration/InMemoryNoteCardListStore.cs` — extend with `FolderId?`
- `web/src/App.tsx` — remove `noteFolderMap`, `notetaker-note-folder-map` from localStorage; filter using `card.folderId`
- `web/src/components/ListView.tsx` — filter `cards` by `card.folderId === currentFolderId`; drag-and-drop handlers on note cards
- `web/src/components/FolderTree.tsx` — add `dragover`/`drop` handlers; call `moveNoteToFolder()` on drop
- `web/src/api.ts` — add `moveNoteToFolder(noteId, folderId)`; add `folderId?: string` to `NoteCard`

**Batches:** Batch 1: domain BDD spec + API integration. Batch 2: E2E + frontend wire-up.

**Scenarios:**

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

**Acceptance criteria:**

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

**Value:** I can see all my unorganised notes in one place, and drag a note there to remove it from its folder.

**Commands in scope:**
- `UnfileNote(NoteId)` → `NoteUnfiled { NoteId }`

**Events in scope:**
- `NoteUnfiled { NoteId }` — new event on `Note` aggregate

**Projections in scope:**
- `NoteCardList` — add `NoteUnfiled` handler (clear `FolderId`)

**API endpoints:**
- `DELETE /notes/{noteId}/folder` — returns 204; unfiles the note

**Unfiled Notes UX (prototype confirmed):**
- "Unfiled Notes" is always present at the top of the folder list in the sidebar
- Clicking it filters the main view to `cards` where `card.folderId` is null
- It acts as a drop target — dropping a note on it calls `DELETE /notes/{id}/folder`
- It is highlighted when active

**Key implementation files:**
- `src/Domain/Notes/NoteCommands.cs` — add `UnfileNote`
- `src/Domain/Notes/NoteEvents.cs` — add `NoteUnfiled`
- `src/Domain/Notes/Note.cs` — add `Apply(NoteUnfiled)`, `HandleUnfileNote`
- `src/EventStore/EventDeserializer.cs` — route `NoteUnfiled`
- `src/EventStore/Projections/NoteCardListProjection.cs` — add `NoteUnfiled` handler (set `FolderId = null`)
- `src/Api/NoteCommandHandler.cs` — add `HandleAsync(UnfileNote)`
- `src/Api/Handlers/NoteHandlers.cs` — add DELETE handler
- `src/Api/Endpoints/NoteEndpoints.cs` — register `DELETE /notes/{noteId}/folder`
- `tests/Specs/Notes/UnfileNoteSpec.cs` — new BDD spec file
- `web/src/components/Sidebar.tsx` — "Unfiled Notes" is active navigation target + drop target
- `web/src/components/ListView.tsx` — when `currentFolderId === UNFILED_ID`, filter `cards` by `!card.folderId`
- `web/src/api.ts` — add `unfileNote(noteId)`

**Scenarios:**

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

**Acceptance criteria:**

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

**Value:** I can peek at a folder's notes with a side panel before deciding to navigate into it.

**Commands in scope:** none

**Events in scope:** none

**Backend changes:** none — preview panel reads from `GET /notes/cards` data already loaded in `App.tsx`.

**Preview panel UX (prototype confirmed):**
- Triggered by `»` button on any folder node in the sidebar
- Slides in (220 px) between sidebar and main content; `×` closes it
- Header shows the folder name; body lists note titles and dates from `cards` filtered by `folderId`
- Clicking a different folder's `»` updates the panel without closing it
- Notes in the panel are draggable (same drag mechanism as note cards in 5-G)
- Panel auto-updates when the folder is navigated to

**Key implementation files:**
- `web/src/components/FolderPreviewPanel.tsx` — build fresh; 220 px slide-out; receives `cards: NoteCard[]`, `folderName: string`, `onClose`; filters internally by `folderId`; notes draggable
- `web/src/components/FolderTree.tsx` — add `»` button on hover; call `onPreview(folderId)` handler
- `web/src/App.tsx` — hold `previewFolderId` state; pass filtered cards to `<FolderPreviewPanel>`

**Scenarios:**

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

**Acceptance criteria:**

- [x] `»` button visible on hover for each folder node
- [x] Clicking `»` opens the panel with the correct folder's notes (titles and dates)
- [x] Notes in the panel are draggable (can be dropped onto other folders)
- [x] Clicking `»` on a different folder updates the panel header and note list
- [x] `×` closes the panel
- [ ] E2E _(superseded by component tests in Phase 6.5)_

---

## Slice 5-J — Auto-assign note to current folder

**Status:** Done

**Value:** When I'm working inside a folder, new notes I create are automatically filed there so I don't have to drag them manually.

**Commands in scope:** reuses `MoveNoteToFolder` from 5-G — fired immediately after `CreateNote` when a folder view is active

**Events in scope:** `NoteFiledInFolder` (from 5-G)

**Backend changes:** none — the command already exists; this is a frontend behaviour change.

**Frontend changes:**
- `App.tsx` — in `handleCreateNote`, after the note is created and the response returns the new `noteId`, if `currentFolderId` is set (and is not `UNFILED_ID`), immediately call `PUT /notes/{noteId}/folder` before navigating to the note screen
- `ListView.tsx` — newly created note appears in the current folder view when the user returns

**Scenarios:**

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

**Acceptance criteria:**

- [x] Creating a note from a folder view (not home, not Unfiled Notes) fires `PUT /notes/{id}/folder` immediately after creation
- [x] The new note appears in the current folder when the user returns to it
- [x] Creating a note from home or Unfiled Notes does not file it anywhere
- [ ] E2E _(superseded by component tests in Phase 6.5)_

---

## Slice 5-K — Reparent a folder

**Status:** Done

**Value:** I can reorganise my folder hierarchy by dragging a folder into another — without losing any of the notes inside.

**Commands in scope:**
- `MoveFolder(FolderId, NewParentFolderId?)` — move to a new parent or to root; must not create a cycle

**Events in scope:**
- `FolderMoved { FolderId, NewParentFolderId? }`

**Projections in scope:**
- `FolderTree` — add `FolderMoved` handler (update `ParentFolderId`)

**API endpoints:**
- `PUT /folders/{folderId}/parent` — body `{ "parentFolderId": "..." | null }`; 200 on success; 400 if cycle; 404 if not found

**Cycle prevention:** The command handler reads the current tree to verify `NewParentFolderId` is not the folder itself or a descendant. The aggregate receives the result as `isDescendant: bool`.

**Key implementation files:**
- `src/Domain/Folders/FolderCommands.cs` — add `MoveFolder`
- `src/Domain/Folders/FolderEvents.cs` — add `FolderMoved`
- `src/Domain/Folders/Folder.cs` — add `Apply(FolderMoved)`, `HandleMoveFolder`
- `src/EventStore/EventDeserializer.cs` — route `FolderMoved`
- `src/EventStore/Projections/FolderTreeProjection.cs` — add `FolderMoved` handler
- `src/Api/FolderCommandHandler.cs` — ancestry check before dispatching `MoveFolder`
- `src/Api/Handlers/FolderHandlers.cs` — add PUT handler
- `src/Api/Endpoints/FolderEndpoints.cs` — register `PUT /folders/{folderId}/parent`
- `tests/Specs/Folders/MoveFolderSpec.cs` — new BDD spec file (reparenting + cycle detection)
- `web/src/components/Sidebar.tsx` — drag folder onto folder in tree calls `moveFolder()`; drop onto root area moves to root
- `web/src/api.ts` — add `moveFolder(folderId, parentFolderId | null)`

**Scenarios:**

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

**Acceptance criteria:**

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

**Value:** I can delete any folder, even one with subfolders and notes inside — everything is cleaned up automatically and the notes appear in Unfiled Notes.

**Commands in scope:** reuses `DeleteFolder` from 5-F — updated to cascade instead of returning 409

**Events produced (by the cascade):**
- `NoteUnfiled` — one per note in the subtree
- `FolderDeleted` — one per descendant folder (bottom-up), then one for the target

**Cascade behaviour (prototype confirmed):**
When `DeleteFolder` is called on a folder with children: the command handler reads the current `FolderTree` projection to find all descendants; fires `UnfileNote` for every note in the subtree; fires `DeleteFolder` for each descendant folder bottom-up; then fires `DeleteFolder` for the target. The event log grows proportionally to subtree size but delete always succeeds.

**API endpoints:**
- `DELETE /folders/{folderId}` — updated to cascade; no longer returns 409 for folders with children

**Key implementation files:**
- `src/Api/FolderCommandHandler.cs` — replace 409 guard with cascade logic (unfile notes, delete descendants bottom-up, delete target)
- `tests/Specs/Folders/DeleteFolderCascadeSpec.cs` — new BDD spec file
- No frontend changes — delete already calls `DELETE /folders/{folderId}`; the sidebar refreshes from `GET /folders`

**Scenarios:**

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

**Acceptance criteria:**

- [x] *(internal)* `DeleteFolder` with descendants: unfiles all notes in subtree (`NoteUnfiled` per note), deletes descendant folders bottom-up (`FolderDeleted`), then deletes target; all correct events appended
- [x] `DELETE /folders/{folderId}` on folder with children cascades cleanly (no more 409)
- [x] All descendant folders disappear from `GET /folders`
- [x] All notes that were in the subtree appear in `GET /notes/cards` with `folderId: null`
- [ ] E2E _(superseded by component tests in Phase 6.5)_

---

## Slice 5-M — Note date defaults to today

**Status:** Done

**Value:** When I create a note, the date is already set to today so I don't have to pick it manually; the note screen shows a clean date input without a redundant formatted label beside it.

**Backend status:** Complete. `SetNoteDate` command handler, `NoteDateSet` event, `NoteDetail` and `NoteCardList` projection handlers, and `PATCH /notes/{noteId}/date` endpoint are all shipped. BDD spec, API integration tests, and acceptance tests exist.

**Commands in scope:** `SetNoteDate` — already implemented; called by the frontend immediately on note creation.

**Frontend changes only:**
- `App.tsx` — in `handleCreateNote`, after `create()` returns `noteId`, call `setNoteDate(noteId, todayAsISO)` before `setView({ kind: "note", noteId })`; derive `todayAsISO` as `new Date().toISOString().slice(0, 10)`
- `NoteView.tsx` — remove the `formatDateDisplay` helper and the `{date && <span data-testid="note-date-display">…</span>}` block; the native `<input type="date">` already shows the selected value

**Scenarios:**

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

**Acceptance criteria:**

- [ ] Creating a note fires `PATCH /notes/{noteId}/date` with today's ISO date immediately after creation; `GET /notes/{noteId}` returns `date = today`
- [ ] `NoteView` renders only `<input type="date">` in the date area — no `<span>` showing a formatted label
- [ ] `formatDateDisplay` is removed from `NoteView.tsx`
- [ ] Date input is pre-filled with today on a freshly created note
- [ ] Changing the date calls `PATCH /notes/{noteId}/date`; the updated date survives a page reload
- [ ] E2E: create a note — date input shows today; navigate home; reopen — date still shows today; change date — new date persists

---

## Slice 5-N — Folder navigation component tests

**Status:** Done

**Value:** Five of the seven tests in `FolderNavigationJourney.cs` test React state transitions and conditional rendering, not full-stack wiring. Moving them to component tests removes Playwright cold-start overhead for checks that do not need a deployed backend, and makes `FolderNavigationJourney.cs` a true boundary-to-boundary smoke test.

**Learning surface:** Testing App-level state machines with RTL — rendering `<App>` with MSW rather than isolating a single component; the rule that an E2E test earns its cost only when the behaviour under test cannot be verified without a real network boundary.

---

**What changes**

Five behaviours move from `FolderNavigationJourney.cs` to a new `web/src/__tests__/FolderNavigation.test.tsx`:

| E2E test removed | Component test equivalent |
|------------------|--------------------------|
| `ClickFolder_ShowsFolderHeading` | MSW `GET /folders` returns one folder; click folder name in sidebar → `<h1>` with folder name is visible |
| `ClickHome_ShowsAllNotes` | Same setup; click folder then click Home button → heading changes to "Home" |
| `FolderView_HidesTodoList` | Click folder → `data-testid="todo-section"` is absent from DOM |
| `HomeView_ShowsTodoList` | App renders at home view → `data-testid="todo-section"` is present |
| `UnfiledNotes_ShowsInSidebar` | App renders → `data-testid="unfiled-notes-button"` is present without any interaction |

Two tests stay in `FolderNavigationJourney.cs` because they verify API round-trips that only exist in the real stack:
- `CreateFolder_AppearsInSidebar` — verifies POST `/folders` response triggers sidebar refresh
- `CreateSubfolder_AppearsNested` — verifies `parentFolderId` wiring through the real API

---

**Key implementation files**

- `web/src/__tests__/FolderNavigation.test.tsx` — new file; renders `<App>`; uses MSW for `GET /folders`, `GET /notes`, `GET /notes/cards`
- `web/src/test/handlers.ts` — extend with `GET /folders` handler returning a minimal folder tree
- `tests/Browser.E2E/Journeys/FolderNavigationJourney.cs` — remove the 5 tests listed above; keep `CreateFolder_AppearsInSidebar` and `CreateSubfolder_AppearsNested`
- `tests/Browser.E2E/Pages/AppPage.cs` — remove any selectors used only by the deleted tests (verify none are shared with the 2 kept tests before deleting)

---

**Scenarios**

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

**Acceptance criteria**

- [ ] `web/src/__tests__/FolderNavigation.test.tsx` contains all 5 component tests; `npm run test` exits 0
- [ ] No test imports a real API URL or requires a deployed backend
- [ ] MSW handlers cover `GET /folders`, `GET /notes`, `GET /notes/cards` for every test
- [ ] Each test asserts on visible output or DOM presence, not component state
- [ ] The 5 tests are deleted from `FolderNavigationJourney.cs`; `CreateFolder_AppearsInSidebar` and `CreateSubfolder_AppearsNested` remain
- [ ] `dotnet build tests/Browser.E2E/Browser.E2E.csproj` exits 0 after deletions
- [ ] `AppPage.cs` compiles with no references to selectors used only by the removed tests

---

## Deferred to backlog

- **Tag suggestions as you type** — `TagIndex` projection powers an autocomplete dropdown. Deferred; the projection is in place, the UI sugar is not.
- **Tag rename / merge** — renaming a tag across all notes requires a new command or projection-only migration. Phase 6+ concern.
- **Touch target accessibility pass** — deferred from Phase 4. Still deferred.
- **Delete action item from home screen** — deferred from Phase 3. Still deferred.
- **Folder-scoped tag filter** — when viewing a folder's notes, the tag filter bar should show only tags present in that folder's cards. Deferred; the global filter is sufficient for Phase 5.
- **Folder colour / icon** — visual differentiation between folders. Deferred; naming is sufficient for Phase 5.
