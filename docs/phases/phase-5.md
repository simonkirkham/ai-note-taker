# Phase 5 — Tags and Folders

**Goal:** Make tags and folders first-class citizens. Users can add and remove tags on any note, see them as pills on the note screen and home cards, and filter the note list by tag. Users can organise notes into a hierarchical folder tree, assign notes by drag-and-drop, and navigate folders via the sidebar. This phase introduces the `TagIndex` projection, the `Folder` aggregate, the `FolderTree` projection, and wires all of them to the frontend.

**Learning surface:** a second projection axis over the existing event stream (`TagIndex`); a brand-new aggregate (`Folder`) with its own event stream; projection evolution (`NoteCardList` extended with `FolderId?`); client-side filter state against a server projection; hierarchical read models.

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

## Slice order and dependencies

```
5-A  Tag a note — full-stack  ───────────────────────────────────┐
5-B  TagIndex + tag filter bar — full-stack  ────────────────────┘  (depends 5-A)

5-C  Folder structure — full-stack  ─────────────────────────────┐
5-D  File notes in folders — full-stack  ────────────────────────┤  (depends 5-C)
5-E  Move and nest folders — full-stack  ────────────────────────┘  (depends 5-C; parallel with 5-D)
```

Each slice delivers a complete vertical: domain events, API endpoints, projections, and the frontend wired to those endpoints — all in one branch. No "backend first, frontend later" splits across slices.

---

## Slice 5-A — Tag a note (full-stack)

**Status:** Not Started

**Value:** The domain gets its first set-membership command: `TagNote` / `UntagNote`, with the aggregate tracking a set of strings and enforcing uniqueness. The full vertical is delivered in one slice: events appended, projections updated, API endpoints live, and the existing prototype UI (`TagsSection`, `NoteCard` pills) wired to real responses. All subsequent tag slices are blocked on this one.

**Commands in scope:**
- `TagNote(NoteId, Tag, TaggedAt)` — note exists, not deleted, tag not already present
- `UntagNote(NoteId, Tag, UntaggedAt)` — note exists, tag present

**Events in scope:**
- `NoteTagged { NoteId, Tag }` — already specified in `docs/event-schemas.md`
- `NoteUntagged { NoteId, Tag }` — already specified in `docs/event-schemas.md`

**Projections in scope:**
- `NoteDetail` — extend to handle `NoteTagged` (add to Tags list) and `NoteUntagged` (remove from Tags list)
- `NoteCardList` — same handlers; `tags` array included in card response DTO

**API endpoints:**
- `POST /notes/{noteId}/tags` — body `{ "tags": "1:1s Bill API" }` (space-tokenised); returns 204; 409 if tag already present
- `DELETE /notes/{noteId}/tags/{tag}` — returns 204; 404 if tag not present

**Key implementation files:**
- `src/Domain/Notes/NoteCommands.cs` — add `TagNote`, `UntagNote`
- `src/Domain/Notes/NoteEvents.cs` — add `NoteTagged`, `NoteUntagged`
- `src/Domain/Notes/Note.cs` — add `_tags` set, `Apply` methods, `HandleTagNote`, `HandleUntagNote`
- `src/EventStore/EventDeserializer.cs` — route `NoteTagged`, `NoteUntagged`
- `src/EventStore/Projections/NoteDetailProjection.cs` — add `NoteTagged`/`NoteUntagged` handlers
- `src/EventStore/Projections/NoteCardListProjection.cs` — add `NoteTagged`/`NoteUntagged` handlers; include `tags` in card response DTO
- `src/Api/NoteCommandHandler.cs` — add `HandleAsync(TagNote)`, `HandleAsync(UntagNote)`
- `src/Api/Handlers/NoteHandlers.cs` — tag endpoints + `tags` in `GET /notes/cards` DTO
- `src/Api/Endpoints/NoteEndpoints.cs` — register `POST /notes/{noteId}/tags`, `DELETE /notes/{noteId}/tags/{tag}`
- `tests/Specs/Notes/TagNoteSpec.cs` — new BDD spec file
- `tests/ApiIntegration/` — extend in-memory stores to handle tags
- `web/src/components/TagsSection.tsx` — build fresh; renders tag pills + input; calls real API
- `web/src/components/NoteView.tsx` — load tags from `getNoteDetail()`; place `<TagsSection>` above `<ActionsSection>`
- `web/src/api.ts` — add `tagNote(noteId, tags)`, `untagNote(noteId, tag)`; add `tags: string[]` to `NoteCard` interface

**Batches:** Batch 1: domain BDD specs + API integration. Batch 2: E2E + frontend wire-up.

**Scenarios:**

```
Scenario: Add a tag to a note
  Given I have a note open
  When  I type "1:1s" in the tag input and press Enter
  Then  a "1:1s" pill appears in the Tags section
  And   the tag is still there when I close and reopen the note

Scenario: Add multiple tags at once by separating with spaces
  Given I have a note open
  When  I type "1:1s Bill API" in the tag input and press Enter
  Then  three tag pills appear: "1:1s", "Bill", and "API"

Scenario: Adding a tag that already exists has no effect
  Given a note already has the tag "1:1s"
  When  I type "1:1s" in the tag input and press Enter
  Then  no second "1:1s" pill appears and no error is shown

Scenario: Remove a tag
  Given a note has tags "1:1s" and "Bill"
  When  I click × on the "Bill" pill
  Then  the "Bill" pill disappears
  And   only "1:1s" remains when I close and reopen the note

Scenario: Tags appear as pills on the home screen note card
  Given I have added tags "1:1s" and "Bill" to a note
  When  I return to the home screen
  Then  the note card shows pills for "1:1s" and "Bill"

Scenario: A note with no tags shows no tag section on its card
  Given I have a note with no tags
  When  I view it on the home screen
  Then  no tag pills appear on its card
```

**Acceptance criteria:**

- [ ] *(internal)* `Note` aggregate tracks `_tags`; `TagNote` on a present tag returns 409; `UntagNote` on missing tag throws
- [ ] *(internal)* `NoteTagged` and `NoteUntagged` are deserialised and routed
- [ ] *(internal)* `NoteDetail` and `NoteCardList` projections fold both events
- [ ] `POST /notes/{noteId}/tags` stores tags; `GET /notes/{noteId}` returns them
- [ ] `POST` with duplicate tag returns 409; no event appended
- [ ] `DELETE /notes/{noteId}/tags/{tag}` removes the tag
- [ ] `GET /notes/cards` response includes `"tags": [...]` for each card
- [ ] Tags section on the note screen loads from `GET /notes/{noteId}` and renders as pills
- [ ] Adding tags via input calls real API; removing pills calls real delete endpoint
- [ ] Duplicate tag from UI handled silently (409 swallowed)
- [ ] Tag pills visible on home screen note cards; no tag area when no tags
- [ ] E2E: create note, add tags "1:1s Bill" on note screen; navigate home — two pills on card; open note again — pills still there

---

## Slice 5-B — TagIndex projection and tag filter bar (full-stack)

**Status:** Not Started

**Value:** A dedicated `TagIndex` projection captures every tag across all notes with counts. `GET /tags` exposes it. The `TagFilter` component is wired to this endpoint, replacing the prototype's client-side tag derivation from cards. Learning surface: projecting a many-to-many relationship (tags ↔ notes) into DynamoDB with a composite key.

**Commands in scope:** none
**Events in scope:** `NoteTagged`, `NoteUntagged`, `NoteDeleted`

**Projections in scope:** `TagIndex` — fully specified in `docs/view-schemas.md`. Storage: table `notetaker-proj-tagindex` (PK: Tag, SK: NoteId).
- `NoteTagged` → put row `(Tag, NoteId, TaggedAt)`
- `NoteUntagged` → delete row
- `NoteDeleted` → delete all rows where `NoteId = …` (table scan; tiny dataset)

**API endpoint:** `GET /tags` — returns `{ "tags": [{ "tag": "1:1s", "noteCount": 3, "noteIds": [...] }] }` ordered by `noteCount` descending.

**CDK changes:** new table `notetaker-proj-tagindex` (PK: `Tag`, SK: `NoteId`); env var `PROJ_TAGINDEX_TABLE_NAME`; `GrantReadWriteData`.

**What changes vs prototype in the frontend:**
- `ListView.tsx` currently derives available tags from card data directly. Replace with `getTags()` call so the filter bar reflects all tags in the index, not just those in the current card list.
- Filter logic stays client-side (filter `cards` by `card.tags`)

**Key implementation files:**
- `src/EventStore/Projections/TagIndexProjection.cs` — new file
- `src/Api/Handlers/TagHandlers.cs` — new `GetTags` handler
- `src/Api/Endpoints/NoteEndpoints.cs` — register `GET /tags`
- `src/Infrastructure/NoteTakerStack.cs` — new CDK table + env var + IAM grant
- `tests/Specs/Projections/TagIndexProjectionSpec.cs` — new spec file
- `tests/ApiIntegration/InMemoryTagIndexStore.cs` — new in-memory implementation
- `tests/InfraAssertions/` — update CDK assertion for new table
- `web/src/components/TagFilter.tsx` — build fresh; receives `tags: TagIndexEntry[]`, `selectedTags: string[]`, `mode: "AND" | "OR"`, `onToggle`, `onModeChange`; active pills visually distinct
- `web/src/components/ListView.tsx` — build with `getTags()` API call; hold `selectedTags` + `filterMode` state; filter `cards` before rendering; render `<TagFilter>` above grid
- `web/src/api.ts` — add `getTags()` returning `TagIndexEntry[]`

**Batches:** Batch 1: projection specs + API integration + CDK assertions. Batch 2: E2E + frontend filter wire-up.

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

Scenario: Removing a tag from its only note removes it from the filter bar
  Given only one note is tagged "rare"
  When  I remove the tag "rare" from that note
  Then  "rare" no longer appears in the filter bar

Scenario: Deleting a note removes its unique tags from the filter bar
  Given a note is the only one tagged "gone"
  When  I delete that note
  Then  "gone" no longer appears in the filter bar

Scenario: Tags used on more notes appear first in the filter bar
  Given "rare" is on 1 note and "common" is on 5 notes
  When  I view the home screen
  Then  "common" appears before "rare" in the filter bar

Scenario: Clicking a tag pill filters the note cards
  Given two notes: one tagged "1:1s", one tagged "Bill"
  When  I click "1:1s" in the filter bar
  Then  only the note tagged "1:1s" is shown

Scenario: Selecting two tags in AND mode shows notes with both
  Given a note tagged "1:1s" and "Bill", and a note tagged only "1:1s"
  When  I select "1:1s" and "Bill" in AND mode
  Then  only the note with both tags is shown

Scenario: Selecting two tags in OR mode shows notes with either
  Given a note tagged "1:1s" and a note tagged "Bill"
  When  I select both in OR mode
  Then  both notes are shown

Scenario: Clearing the filter shows all notes again
  Given I have filtered by "1:1s" in OR mode
  When  I click Clear
  Then  all note cards are shown and the toggle resets to AND
```

**Acceptance criteria:**

- [ ] *(internal)* `TagIndex` projection folds `NoteTagged`, `NoteUntagged`, `NoteDeleted` correctly
- [ ] *(internal)* `NoteDeleted` cleanup removes all tag rows for that note
- [ ] *(internal)* CDK template includes `notetaker-proj-tagindex` with composite key
- [ ] `GET /tags` returns tags with `noteCount` and `noteIds`; ordered by count descending
- [ ] Home screen filter bar populated from `GET /tags`; hidden when no tags exist
- [ ] Clicking a tag pill filters cards to matching notes
- [ ] AND/OR toggle visible; default AND
- [ ] Clearing filter resets selected tags and mode
- [ ] E2E: create two notes tagged differently; activate filter — only matching card shown; clear — both shown

---

## Slice 5-C — Folder structure (full-stack)

**Status:** Not Started

**Value:** Introduces the `Folder` aggregate, `FolderTree` projection, and wires the sidebar (Home button, Unfiled Notes item, folder tree, `»` preview panel) to the real API. Users can create, rename, and delete folders in a sidebar tree. The `»` button on each folder opens a slide-out panel listing that folder's notes with dates. No note assignment yet — just the tree structure.

**Commands in scope:**
- `CreateFolder(FolderId, Name, ParentFolderId?)` — name must be non-empty
- `RenameFolder(FolderId, NewName)` — folder exists, name non-empty
- `DeleteFolder(FolderId)` — folder exists; cascading behaviour confirmed in 5-E (for now, return 409 if children)

**Events in scope:**
- `FolderCreated { FolderId, Name, ParentFolderId? }`
- `FolderRenamed { FolderId, NewName }`
- `FolderDeleted { FolderId }`

**Projections in scope:** `FolderTree` — builds the full hierarchical structure.
- Storage: table `notetaker-proj-foldertree` (PK: `FolderId`). Each row: `FolderId`, `Name`, `ParentFolderId?`, `CreatedAt`.
- `FolderCreated` → put row; `FolderRenamed` → update Name; `FolderDeleted` → delete row

**API endpoints:**
- `POST /folders` — body `{ "name": "People", "parentFolderId": null }`; returns 201 with `{ "folderId": "..." }`
- `PATCH /folders/{folderId}/name` — body `{ "name": "..." }`; returns 200
- `DELETE /folders/{folderId}` — returns 204 on empty folder; 409 if folder has children (cascade handled in 5-E)
- `GET /folders` — returns the full folder tree as nested JSON

**CDK changes:** new table `notetaker-proj-foldertree` (PK: `FolderId`); env var `PROJ_FOLDERTREE_TABLE_NAME`; `GrantReadWriteData`.

**Sidebar UX (prototype confirmed):**
- **Home button** at the top — always visible; navigates to the home list view
- **"+ New Note" button** below Home
- **Folders section** below, containing:
  - **"Unfiled Notes"** — always-present special item at the top of the folder list; acts as a drop target (dropping a note on it unfiles it); highlighted when active; no rename/delete
  - **Folder tree** — recursive list of real folders with expand/collapse, hover actions (+subfolder, rename, delete), `»` preview button
  - **"New folder" inline input** — appears when + is clicked in the folder section header

**Folder tree interaction (prototype confirmed):**
- Click folder name → navigate to that folder's note view; preview panel auto-updates
- Double-click folder name → inline rename input
- Hover actions: `»` (open preview panel), `+` (add subfolder), `✎` (rename), `×` (delete)
- Drag-over highlight (teal outline) when a note card is dragged over a folder node

**Preview panel UX (prototype confirmed):**
- Triggered by `»` button or by clicking a folder name when panel is already open
- Slides in (220px) between sidebar and main content; `×` closes it
- Header shows folder name; list shows note titles + dates
- Notes in the panel are draggable (same mechanism as note cards)
- Panel auto-updates when navigating to a different folder

**"← Save" button:** The back/save button on the note screen reads "← Save" (confirmed in prototype, applies across all notes regardless of folder state).

**What changes vs prototype in this slice:**
- Replace `localStorage` folder state with real API calls (`POST /folders`, `PATCH`, `DELETE`, `GET /folders` on mount)
- Remove `notetaker-folders` from localStorage; load from API on mount
- `FolderPreviewPanel` notes list: use interim `noteFolderMap` local state in this slice; replaced properly in 5-D when `card.folderId` is available

**Key implementation files:**
- `src/Domain/Folders/` — new: `FolderCommands.cs`, `FolderEvents.cs`, `Folder.cs`
- `src/EventStore/EventDeserializer.cs` — route folder events
- `src/EventStore/Projections/FolderTreeProjection.cs` — new file
- `src/Api/FolderCommandHandler.cs` — new command handler
- `src/Api/Handlers/FolderHandlers.cs` — new HTTP handlers
- `src/Api/Endpoints/FolderEndpoints.cs` — register folder endpoints
- `src/Infrastructure/NoteTakerStack.cs` — new CDK table + env var + IAM grant
- `tests/Specs/Folders/FolderSpec.cs` — new BDD spec file
- `tests/ApiIntegration/InMemoryFolderTreeStore.cs` — new in-memory implementation
- `tests/InfraAssertions/` — update CDK assertion for new table
- `web/src/App.tsx` — replace `localStorage` folder init with `getFolders()` API call on mount; `handleCreateFolder` calls real API and uses returned `folderId`
- `web/src/components/Sidebar.tsx` — build fresh per prototype confirmed UX
- `web/src/components/FolderTree.tsx` — build fresh; recursive component with expand/collapse and hover actions
- `web/src/components/FolderPreviewPanel.tsx` — build fresh; 220px slide-out panel

**Batches:** Batch 1: domain BDD specs + API integration + CDK assertions. Batch 2: E2E + frontend wire-up.

**Scenarios:**

```
Scenario: Create a folder
  Given I open the sidebar
  When  I click + in the Folders section, type "People", and confirm
  Then  "People" appears in the sidebar folder list

Scenario: Create a subfolder
  Given folder "People" exists in the sidebar
  When  I hover over "People", click + to add a subfolder, type "Bill", and confirm
  Then  "Bill" appears nested under "People" in the sidebar

Scenario: Rename a folder
  Given folder "Peopl" exists in the sidebar
  When  I double-click "Peopl", change the name to "People", and press Enter
  Then  the folder shows the corrected name "People"

Scenario: Delete an empty folder
  Given folder "People" has no subfolders
  When  I click × on "People"
  Then  "People" disappears from the sidebar

Scenario: Cannot delete a folder that has subfolders
  Given folder "People" has a subfolder "Bill"
  When  I try to delete "People"
  Then  the folder is not removed

Scenario: My folders are shown when I open the app
  Given I created folders "People" and "Projects" in a previous session
  When  I open the app
  Then  "People" and "Projects" appear in the sidebar

Scenario: Clicking a folder shows its notes and updates the preview panel
  Given folder "People" has a subfolder "Bill"
  When  I click "Bill" in the sidebar
  Then  the main area shows "People → Bill" as the heading
  And   the preview panel shows "Bill"'s notes
```

**Acceptance criteria:**

- [ ] *(internal)* `Folder` aggregate folds `FolderCreated`, `FolderRenamed`, `FolderDeleted`; empty name throws; children → 409 from API
- [ ] *(internal)* `FolderTree` projection folds all folder events correctly
- [ ] *(internal)* CDK template includes `notetaker-proj-foldertree` table
- [ ] `POST /folders` creates a folder; `GET /folders` returns it in the nested tree
- [ ] `PATCH /folders/{folderId}/name` renames the folder
- [ ] `DELETE /folders/{folderId}` on empty folder deletes; on folder with children returns 409
- [ ] Sidebar loads folder tree from `GET /folders` on app mount (replaces `localStorage` init)
- [ ] Home button in sidebar navigates to home list view
- [ ] "Unfiled Notes" always visible at top of folder list; highlighted when active
- [ ] `»` button on a folder opens the slide-out preview panel; clicking a different folder updates the panel
- [ ] Preview panel shows correct note titles and dates for the selected folder
- [ ] Notes in preview panel are draggable (same drag-and-drop mechanism as note cards)
- [ ] "← Save" button on note screen (not "← Back")
- [ ] E2E: create folders "People" and child "Bill"; sidebar shows tree; click "Bill"; main area shows "People → Bill"; `»` panel shows Bill's notes

---

## Slice 5-D — File notes in folders (full-stack)

**Status:** Not Started

**Value:** Notes can be filed into folders by drag-and-drop. The Unfiled Notes view shows only notes not in any folder. Creating a note from within a folder view auto-assigns it. The todo section is hidden in folder views. This wires the drag-and-drop frontend to real backend events and removes all `localStorage` state for folder assignment.

**Commands in scope:**
- `MoveNoteToFolder(NoteId, FolderId)` → `NoteFiledInFolder { NoteId, FolderId }`
- `UnfileNote(NoteId)` → `NoteUnfiled { NoteId }`

**Events in scope:**
- `NoteFiledInFolder { NoteId, FolderId }` — new event on `Note` aggregate
- `NoteUnfiled { NoteId }` — new event on `Note` aggregate

**Projections in scope:**
- `NoteCardList` — extend with `FolderId?` field; handlers for `NoteFiledInFolder` (set FolderId) and `NoteUnfiled` (clear FolderId)

**API endpoints:**
- `PUT /notes/{noteId}/folder` — body `{ "folderId": "..." }`; returns 204; 404 if note or folder not found
- `DELETE /notes/{noteId}/folder` — returns 204 (unfiles the note)
- `GET /notes/cards` — each card now includes `folderId?: string`; client filters by this field

**Folder assignment UX (prototype confirmed):**
- **Drag-only** — no folder picker dropdown on the note screen. Assignment happens by:
  1. Dragging a note card from the main list onto a folder in the sidebar tree
  2. Dragging a note from the `»` preview panel onto a different folder
  3. Dragging a note onto "Unfiled Notes" to remove folder assignment
- All drag sources use `dataTransfer.setData("text/plain", noteId)`

**Auto-assign on create (prototype confirmed):**
- When the user clicks "+ New Note" from within a folder view (not home or Unfiled Notes), the new note is automatically filed in the current folder immediately after creation

**Todo section visibility (prototype confirmed):**
- `<TodoSection>` is shown **only** on the home view (no `currentFolderId`)
- Hidden in all folder views including "Unfiled Notes"

**What changes vs prototype in this slice:**
- Replace fire-and-forget `moveNoteToFolder` / `unfileNote` stubs with real API calls
- Replace `noteFolderMap` local state + `localStorage` with `card.folderId` from `GET /notes/cards` response
- Replace `noteDateMap` local state with `card.date` from card response
- Remove `notetaker-note-folder-map` and `notetaker-note-date-map` from `localStorage`
- Remove `noteFolderMap` and `noteDateMap` state from `App.tsx`; filter using `card.folderId` directly
- `FolderPreviewPanel` receives filtered `cards` (already from API) instead of filtering `notes` by local map
- `ListView` filters cards by `card.folderId === currentFolderId` (server field, not local map)

**Key implementation files:**
- `src/Domain/Notes/NoteCommands.cs` — add `MoveNoteToFolder`, `UnfileNote`
- `src/Domain/Notes/NoteEvents.cs` — add `NoteFiledInFolder`, `NoteUnfiled`
- `src/Domain/Notes/Note.cs` — add `_folderId` state; handlers and Apply methods
- `src/EventStore/EventDeserializer.cs` — route new events
- `src/EventStore/Projections/NoteCardListProjection.cs` — add `FolderId?` to `NoteCardView`; add handlers
- `src/Api/NoteCommandHandler.cs` — add `HandleAsync(MoveNoteToFolder)`, `HandleAsync(UnfileNote)`
- `src/Api/Handlers/NoteHandlers.cs` — add HTTP handlers; ensure `folderId` included in card response
- `src/Api/Endpoints/NoteEndpoints.cs` — register `PUT /notes/{noteId}/folder`, `DELETE /notes/{noteId}/folder`
- `tests/Specs/Notes/MoveNoteToFolderSpec.cs` — new BDD spec file
- `tests/ApiIntegration/InMemoryNoteCardListStore.cs` — extend with `FolderId?`
- `web/src/App.tsx` — remove `noteFolderMap`, `noteDateMap`, localStorage keys; pass `cards` to preview panel; filter by `card.folderId`; auto-assign on new note in folder view calls real `PUT /notes/{id}/folder`
- `web/src/components/ListView.tsx` — filter `cards` by `card.folderId === currentFolderId`; Unfiled filters `!card.folderId`
- `web/src/components/FolderPreviewPanel.tsx` — accept `cards: NoteCard[]`; use `card.date`; filter by `card.folderId`
- `web/src/api.ts` — add `moveNoteToFolder(noteId, folderId)`, `unfileNote(noteId)`; add `folderId?: string` to `NoteCard` interface

**Batches:** Batch 1: domain BDD specs + API integration. Batch 2: E2E + frontend wire-up.

**Scenarios:**

```
Scenario: Drag a note into a folder
  Given I have an unfiled note and a folder "Projects" in the sidebar
  When  I drag the note card onto "Projects"
  Then  the note disappears from the home view
  And   it appears when I click "Projects" in the sidebar

Scenario: Drag a note to a different folder
  Given a note is filed under "People"
  When  I open "People"'s preview panel and drag the note onto "Projects"
  Then  the note appears under "Projects" and is no longer under "People"

Scenario: Drag a note onto "Unfiled Notes" removes its folder
  Given a note is filed under "People"
  When  I drag the note onto "Unfiled Notes" in the sidebar
  Then  the note appears in the Unfiled Notes view and is gone from "People"

Scenario: Unfiled Notes shows only notes not in any folder
  Given one note is in folder "Projects" and another has no folder
  When  I click "Unfiled Notes" in the sidebar
  Then  only the note with no folder is shown

Scenario: Folder view shows only notes filed in that folder
  Given one note is in folder "Bill" and another is unfiled
  When  I click "Bill" in the sidebar
  Then  only the note in "Bill" is shown

Scenario: A new note created from a folder view is auto-filed there
  Given I am viewing folder "Projects"
  When  I click "+ New Note"
  Then  the new note immediately appears under "Projects"

Scenario: The todo list is hidden when viewing a folder
  Given I click any folder in the sidebar
  When  the folder view loads
  Then  the todo list is not shown

Scenario: The todo list is visible on the home view
  Given I click the Home button
  When  the home view loads
  Then  the todo list is shown
```

**Acceptance criteria:**

- [ ] *(internal)* `Note` aggregate handles `MoveNoteToFolder` and `UnfileNote`; fires correct events
- [ ] *(internal)* `NoteCardList` projection folds `NoteFiledInFolder` (sets `FolderId`) and `NoteUnfiled` (clears `FolderId`)
- [ ] `PUT /notes/{noteId}/folder` files a note; `GET /notes/cards` returns it with `folderId` set
- [ ] `DELETE /notes/{noteId}/folder` unfiles a note; `GET /notes/cards` returns it with `folderId: null`
- [ ] "Unfiled Notes" view (sidebar) shows only cards where `card.folderId` is null
- [ ] Folder view shows only cards where `card.folderId === activeFolderId`
- [ ] Dragging a note card onto a sidebar folder calls `PUT /notes/{id}/folder`
- [ ] Dragging a note from the `»` preview panel onto a different folder re-files it
- [ ] Dragging a note onto "Unfiled Notes" calls `DELETE /notes/{id}/folder`
- [ ] Creating a note from a folder view auto-assigns it to that folder via `PUT /notes/{id}/folder`
- [ ] Todo section hidden in all folder views (including Unfiled Notes); visible only on home
- [ ] `noteFolderMap` and `noteDateMap` removed from `localStorage` and `App.tsx` state
- [ ] E2E: create note and folder; drag note onto folder; verify in folder view; drag to "Unfiled Notes"; verify in unfiled view

---

## Slice 5-E — Move and nest folders + cascade delete (full-stack)

**Status:** Not Started

**Value:** The folder tree is fully malleable — users can drag a folder onto another folder to reparent it. Cascade delete is implemented: deleting a folder with children automatically unfiles all notes in the subtree, deletes descendant folders bottom-up, then deletes the target folder. This eliminates the 409 guard from 5-C.

**Commands in scope:**
- `MoveFolder(FolderId, NewParentFolderId?)` — move to new parent or to root; must not create a cycle

**Events in scope:**
- `FolderMoved { FolderId, NewParentFolderId? }`

**Projections in scope:**
- `FolderTree` — add handler for `FolderMoved` (update `ParentFolderId`); update `DeleteFolder` cascade logic

**Cascade delete (prototype-confirmed behaviour):**
When `DeleteFolder` is called on a folder with children: automatically unfile all notes in the folder and all descendant folders (`NoteUnfiled` events), then delete all descendant folders bottom-up (`FolderDeleted` events), then delete the target folder. The event log grows proportionally to subtree size but the UX is clean — delete always works. Replaces the 5-C 409 guard.

**API endpoints:**
- `PUT /folders/{folderId}/parent` — body `{ "parentFolderId": "..." | null }`; 200 on success; 400 if cycle; 404 if not found
- `DELETE /folders/{folderId}` — updated to cascade (overrides 5-C 409 behaviour)

**Cycle prevention:** `MoveFolder` handler reads current tree to verify `NewParentFolderId` is not the folder itself or any of its descendants. Check in the command handler (not aggregate) — aggregate receives `isDescendant: bool`.

**Key implementation files:**
- `src/Domain/Folders/FolderCommands.cs` — add `MoveFolder`
- `src/Domain/Folders/FolderEvents.cs` — add `FolderMoved`
- `src/Domain/Folders/Folder.cs` — add `Apply(FolderMoved)`, `HandleMoveFolder`
- `src/EventStore/EventDeserializer.cs` — route `FolderMoved`
- `src/EventStore/Projections/FolderTreeProjection.cs` — add `FolderMoved` handler; cascade delete logic
- `src/Api/FolderCommandHandler.cs` — `MoveFolder` (ancestry check); `DeleteFolder` cascade (unfile notes, delete descendants, delete target)
- `src/Api/Handlers/FolderHandlers.cs` — add `PUT /folders/{folderId}/parent`; update `DELETE` to cascade
- `src/Api/Endpoints/FolderEndpoints.cs` — register `PUT /folders/{folderId}/parent`
- `tests/Specs/Folders/MoveFolderSpec.cs` — new BDD spec file (reparenting + cycle detection)
- `tests/Specs/Folders/DeleteFolderCascadeSpec.cs` — new BDD spec file (cascade delete)
- `web/src/components/Sidebar.tsx` — drag folder onto folder calls `moveFolder()`; drop onto root area moves to root
- `web/src/api.ts` — add `moveFolder(folderId, parentFolderId | null)`

**Batches:** Batch 1: domain BDD specs + API integration. Batch 2: E2E + frontend drag-folder.

**Scenarios:**

```
Scenario: Drag a folder onto another folder to reparent it
  Given "Bill" is under "People" and "Projects" exists in the sidebar
  When  I drag "Bill" onto "Projects"
  Then  "Bill" appears under "Projects" and is no longer under "People"

Scenario: Drag a folder to the root level
  Given "Bill" is a subfolder of "People"
  When  I drag "Bill" to an empty area at the top of the folder list
  Then  "Bill" appears at the root level alongside "People"

Scenario: Dragging a folder into one of its own subfolders does nothing
  Given folder "People" has a subfolder "Bill"
  When  I try to drag "People" onto "Bill"
  Then  the folder tree is unchanged

Scenario: Deleting a folder with subfolders removes everything and unfiles their notes
  Given folder "People" has subfolder "Bill" and a note is filed in "Bill"
  When  I delete "People"
  Then  both "People" and "Bill" disappear from the sidebar
  And   the note that was in "Bill" appears in Unfiled Notes
```

**Acceptance criteria:**

- [ ] *(internal)* `MoveFolder` appends `FolderMoved`; cycle detection rejects moves into own descendants
- [ ] *(internal)* `FolderTree` projection updates `ParentFolderId` on `FolderMoved`
- [ ] *(internal)* `DeleteFolder` with descendants: unfiles all notes in subtree, deletes descendants bottom-up, deletes target; all correct events appended
- [ ] `PUT /folders/{folderId}/parent` reparents the folder; `GET /folders` reflects new tree
- [ ] `PUT /folders/{folderId}/parent` with cycle returns 400
- [ ] `DELETE /folders/{folderId}` on folder with children cascades cleanly (no more 409)
- [ ] Drag folder onto folder in sidebar reparents it
- [ ] E2E: create "People > Bill"; drag "Bill" onto "Projects"; verify tree; delete "People" — "People" gone, "Projects > Bill" intact

---

## Deferred to backlog

- **Tag suggestions as you type** — `TagIndex` projection powers an autocomplete dropdown. Deferred; the projection is in place, the UI sugar is not.
- **Tag rename / merge** — renaming a tag across all notes requires a new command or projection-only migration. Phase 6+ concern.
- **Touch target accessibility pass** — deferred from Phase 4. Still deferred.
- **Delete action item from home screen** — deferred from Phase 3. Still deferred.
- **Folder-scoped tag filter** — when viewing a folder's notes, the tag filter bar should show only tags present in that folder's cards. Deferred; the global filter is sufficient for Phase 5.
- **Folder colour / icon** — visual differentiation between folders. Deferred; naming is sufficient for Phase 5.
