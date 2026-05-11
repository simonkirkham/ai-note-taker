# Phase 5 — Tags and Folders

**Goal:** Make tags and folders first-class citizens. Users can add and remove tags on any note, see them rendered as pills on the note screen and home cards, and filter the note list by tag. Users can also organise notes into a hierarchical folder tree, drag notes between folders, and navigate the tree in the sidebar. This phase introduces the `TagIndex` projection, the `Folder` aggregate, the `FolderTree` projection, and wires all of them to new and extended UI surfaces.

**Learning surface:** a second projection axis over the existing event stream (`TagIndex`); a brand-new aggregate (`Folder`) with its own event stream; projection evolution (`NoteCardList` extended with `FolderId?`); client-side filter state against a server projection; hierarchical read models.

---

## What is already in place

Before Breaker starts, note that Phase 4 has already:

- Modelled `TagNote` / `UntagNote` commands and `NoteTagged` / `NoteUntagged` events in `docs/event-model.md` and `docs/event-schemas.md`.
- Stored `Tags` as a string set in the `NoteCardList` projection DynamoDB row (`view-schemas.md`).
- Stored `Tags` in the `NoteDetail` projection (as `IReadOnlyList<string>`).
- Specified the `TagIndex` projection fully in `docs/view-schemas.md`.
- Rendered tag areas as **empty placeholders** in Phase 4 (`NoteCard.tsx`, `NoteView.tsx` right panel).

What is **not** yet in place:

- No `TagNote` / `UntagNote` command handlers in `src/Api/`.
- No `NoteTagged` / `NoteUntagged` events in `src/Domain/Notes/NoteEvents.cs`.
- No `TagNote` / `UntagNote` commands in `src/Domain/Notes/NoteCommands.cs`.
- `NoteCardList` and `NoteDetail` projections do not yet handle `NoteTagged` / `NoteUntagged`.
- No `TagIndex` projection exists in `src/EventStore/Projections/`.
- No tag input UI on the note screen.
- No tag pill rendering on note cards or note screen.
- No tag filter UI on the home screen.
- No `Folder` aggregate, events, commands, or command handler.
- No `FolderTree` projection.
- No folder tree in the sidebar.
- No `NoteFiledInFolder` / `NoteUnfiled` events on the `Note` aggregate.

---

## Slice order and dependencies

```
5-A  Tag a note (domain + API)  ─────────────────────────────────┐
5-B  Tags on note screen (frontend)  ────────────────────────────┤  (depends 5-A)
5-C  Tags on home cards (frontend)  ─────────────────────────────┤  (depends 5-A)
5-D  TagIndex projection + API endpoint  ────────────────────────┤  (depends 5-A)
5-E  Filter by tag on home screen  ──────────────────────────────┘  (depends 5-C + 5-D)

5-F  Folder aggregate + sidebar tree  ───────────────────────────┐
5-G  File notes in folders  ─────────────────────────────────────┤  (depends 5-F)
5-H  Move and nest folders  ─────────────────────────────────────┘  (depends 5-F; parallel with 5-G)
```

5-A is the foundation for the tag slices: it lands the domain events, command handlers, and API endpoints that 5-B through 5-E rely on. 5-B and 5-C are pure frontend and can run in parallel once 5-A is merged. 5-D can run in parallel with 5-B/5-C — it requires the `NoteTagged`/`NoteUntagged` events (5-A) but is independent of the frontend slices. 5-E depends on both the filter endpoint (5-D) and the tag pills being visible on cards (5-C).

5-F is the foundation for the folder slices: it introduces the `Folder` aggregate, `FolderTree` projection, and sidebar tree with no note assignment. 5-G and 5-H both depend on 5-F and can run in parallel with each other after 5-F is merged. The tag slices (5-A to 5-E) and folder slices (5-F to 5-H) are independent and can be sequenced in any order.

---

## Slice 5-A — Tag a note (domain + API)

**Status:** Not Started

**Value:** The domain gets its first set-membership command: one `TagNote` per token, idempotent on duplicates, mirrored by `UntagNote`. This is the foundational event-sourcing learning moment for Phase 5 — the aggregate must track a set of strings and enforce uniqueness, which surfaces how state is held across events without a database. All subsequent tag slices are blocked on this one.

**Commands in scope:**
- `TagNote(NoteId, Tag, TaggedAt)` — note exists, not deleted, tag not already present
- `UntagNote(NoteId, Tag, UntaggedAt)` — note exists, tag present

**Events in scope:**
- `NoteTagged { NoteId, Tag }` — already specified in `docs/event-schemas.md`
- `NoteUntagged { NoteId, Tag }` — already specified in `docs/event-schemas.md`

**Projections in scope:**
- `NoteDetail` — extend to handle `NoteTagged` (add to Tags list) and `NoteUntagged` (remove from Tags list); update `LastModifiedAt`
- `NoteCardList` — same handlers; Tags are already stored as a string set in the DynamoDB row but the projection currently ignores `NoteTagged`/`NoteUntagged`

**API endpoints:**
- `POST /notes/{noteId}/tags` — body `{ "tags": "1:1s Bill API" }` (space-tokenised on server); returns 204 on success, 404 if note not found, 409 if the tag token is already present on the note (frontend handles 409 silently — no error shown to the user)
- `DELETE /notes/{noteId}/tags/{tag}` — returns 204 on success, 404 if note not found or tag not present

**Key implementation files:**
- `src/Domain/Notes/NoteCommands.cs` — add `TagNote`, `UntagNote`
- `src/Domain/Notes/NoteEvents.cs` — add `NoteTagged`, `NoteUntagged`
- `src/Domain/Notes/Note.cs` — add `_tags` set, `Apply(NoteTagged)`, `Apply(NoteUntagged)`, `HandleTagNote`, `HandleUntagNote`
- `src/EventStore/EventDeserializer.cs` — route `NoteTagged`, `NoteUntagged`
- `src/EventStore/Projections/NoteDetailProjection.cs` — add `NoteTagged`/`NoteUntagged` handlers; add `Tags` to `NoteDetailView` record
- `src/EventStore/Projections/NoteCardListProjection.cs` — add `NoteTagged`/`NoteUntagged` handlers; add `Tags` to `NoteCardView` record
- `src/Api/NoteCommandHandler.cs` — add `HandleAsync(TagNote)`, `HandleAsync(UntagNote)`
- `src/Api/Handlers/NoteHandlers.cs` — add `TagNote`, `UntagNote` HTTP handlers
- `src/Api/Endpoints/NoteEndpoints.cs` — register `POST /notes/{noteId}/tags`, `DELETE /notes/{noteId}/tags/{tag}`
- `tests/Specs/Notes/TagNoteSpec.cs` — new BDD spec file
- `tests/ApiIntegration/` — extend in-memory stores to handle tags
- `web/src/api.ts` — add `tagNote(noteId, tags)`, `untagNote(noteId, tag)`

**Layer split:** Yes — new events + new aggregate state + two projection changes + two API endpoints + E2E. Batch 1: domain BDD specs + API integration. Batch 2: E2E (minimal — just confirm tags appear in `NoteDetail` response).

**Scenarios:**

```
Scenario: Tag a note with a single token
  Given a note exists
  When  POST /notes/{noteId}/tags with body { "tags": "1:1s" }
  Then  NoteTagged { Tag: "1:1s" } is appended to the stream
  And   GET /notes/{noteId} returns tags: ["1:1s"]

Scenario: Tag input with multiple space-separated tokens emits one event per token
  Given a note exists
  When  POST /notes/{noteId}/tags with body { "tags": "1:1s Bill API" }
  Then  three NoteTagged events are appended

Scenario: Tagging with a token already present returns 409
  Given a note tagged "1:1s"
  When  POST /notes/{noteId}/tags with body { "tags": "1:1s" }
  Then  409 Conflict is returned
  And   no NoteTagged event is appended

Scenario: Remove a tag
  Given a note tagged "1:1s"
  When  DELETE /notes/{noteId}/tags/1:1s
  Then  NoteUntagged { Tag: "1:1s" } is appended
  And   GET /notes/{noteId} returns tags: []

Scenario: Cannot remove a tag that is not present
  Given a note with no tags
  When  UntagNote is handled
  Then  InvalidOperationException is thrown

Scenario: Cannot tag a deleted note
  Given a note that has been deleted
  When  TagNote is handled
  Then  InvalidOperationException is thrown
```

**Acceptance criteria:**

- [ ] *(internal)* `Note` aggregate tracks a `_tags` set; `TagNote` on a present tag returns 409; `UntagNote` on a missing tag throws
- [ ] *(internal)* `NoteTagged` and `NoteUntagged` are deserialised and routed by `EventDeserializer`
- [ ] *(internal)* `NoteDetail` projection folds `NoteTagged` (adds to list) and `NoteUntagged` (removes from list)
- [ ] *(internal)* `NoteCardList` projection folds `NoteTagged` and `NoteUntagged`
- [ ] `POST /notes/{noteId}/tags` with `{ "tags": "A B" }` stores both tags; `GET /notes/{noteId}` returns `"tags": ["A","B"]`
- [ ] `POST /notes/{noteId}/tags` with a tag already present on the note returns 409; no event appended
- [ ] `DELETE /notes/{noteId}/tags/{tag}` removes the tag; subsequent GET confirms removal
- [ ] E2E: create a note, POST a tag, GET the note detail — tag present in response

---

## Slice 5-B — Tag input and pills on the note screen

**Status:** Not Started

**Value:** Users can see and manage tags directly from the note screen — the primary editing surface. The right panel (already showing "Actions") gains a "Tags" section above it, matching the wireframe exactly. This makes tags real for the first time in the UI.

**Commands in scope:** reuses `TagNote`, `UntagNote` (from 5-A)
**Events in scope:** none new
**New backend:** none — pure frontend; calls the endpoints added in 5-A

**Wireframe reference:** `docs/wireframes/Note Screen.png` — Tags section above Actions in the right panel, showing pills "1:1s", "Bill", "API Integration", "OKRs".

**Key implementation files:**
- `web/src/components/TagsSection.tsx` — new component; receives `tags: string[]`, `onAdd(tags: string)`, `onRemove(tag: string)`; renders tag pills with remove button; text input + Enter/blur to add
- `web/src/components/NoteView.tsx` — load `tags` from `NoteDetail` response; place `<TagsSection>` above `<ActionsSection>` in the right panel; wire add/remove to API calls; handle 409 silently (no error shown)
- `web/src/api.ts` — already added in 5-A; no new API functions needed
- `web/src/App.css` — `.tags-section`, `.tag-pill`, `.tag-pill-remove`, `.tags-input`

**Input behaviour:** text input in the Tags box; on Enter or blur, tokenise on whitespace, call `tagNote()` for each new token, clear input. Individual pill has a `×` remove button that calls `untagNote()`. If the server returns 409 for an already-present tag, the frontend discards the error silently.

**Layer split:** No — pure frontend, single batch.

**Scenarios:**

```
Scenario: Tags panel is visible in the right panel of the note screen
  Given I open a note
  Then  a "Tags" section is visible above the Actions panel

Scenario: Adding tags via Enter renders them as pills
  Given I am on the note screen with no tags
  When  I type "1:1s Bill" in the tag input and press Enter
  Then  two tag pills "1:1s" and "Bill" appear in the Tags section

Scenario: Tags persist across navigation
  Given I have added tags "1:1s" and "Bill" to a note
  When  I navigate away and return to the note
  Then  both tag pills are still visible

Scenario: Removing a tag pill removes it immediately
  Given a note has tags "1:1s" and "Bill"
  When  I click the × on the "Bill" pill
  Then  only "1:1s" remains in the Tags section

Scenario: Tag input clears after submission
  Given I type "Meeting" in the tag input and press Enter
  Then  the tag pill appears and the input field is cleared

Scenario: Adding a duplicate tag shows no error
  Given a note tagged "1:1s"
  When  I type "1:1s" in the tag input and press Enter
  Then  no error is shown and the pill list is unchanged
```

**Acceptance criteria:**

- [ ] Tags section with heading "Tags" appears above Actions in the right panel of the note screen
- [ ] Existing tags load from `NoteDetail` and render as pills when the note screen opens
- [ ] Typing in the tag input and pressing Enter (or blurring) adds new tags as pills and clears the input
- [ ] Whitespace-separated input ("A B") creates separate pills for each token
- [ ] Clicking `×` on a pill removes that tag immediately from the UI and persists the removal
- [ ] Adding a duplicate tag (409 from server) is handled silently — no error banner or alert shown
- [ ] E2E: open a note, add tags "1:1s Bill", verify two pills visible; remove "Bill", verify only "1:1s" remains after navigation

---

## Slice 5-C — Tag pills on home screen cards

**Status:** Not Started

**Value:** Tag pills appear on each note card on the home screen, matching the wireframe. Users can see at a glance which topics a note belongs to without opening it. `NoteCardList` already stores tags — this slice makes them visible in the React component.

**Commands in scope:** none
**Events in scope:** none
**New backend:** none — `NoteCardList` already stores tags in the DynamoDB row (after 5-A extends the projection); `GET /notes/cards` must return the `tags` array

**API change:** `GET /notes/cards` response — add `"tags": ["1:1s", "Bill"]` to each card object. This requires:
- `NoteCardView` record in `NoteCardListProjection.cs` has a `Tags` field (added in 5-A)
- The HTTP handler maps `Tags` into the wire response
- `web/src/api.ts` — add `tags: string[]` to the `NoteCard` interface

**Wireframe reference:** `docs/wireframes/Homescreen with note summary.png` — "Tags" label followed by pills "1:1s", "Bill", "API Integration", "OKRs" below the content snippet.

**Key implementation files:**
- `src/Api/Handlers/NoteHandlers.cs` — ensure `tags` field is included in the `GET /notes/cards` response DTO
- `web/src/api.ts` — add `tags: string[]` to `NoteCard` interface
- `web/src/components/NoteCard.tsx` — render tag pills below content snippet; add "Tags" label if tags present
- `web/src/App.css` — `.note-card-tags`, `.note-card-tag-pill`

**Layer split:** No — minor backend wire change + frontend render. Single batch.

**Scenarios:**

```
Scenario: Tag pills appear on the note card
  Given a note has tags "1:1s" and "Bill"
  When  I view the home screen
  Then  the note card shows pills "1:1s" and "Bill" below the content snippet

Scenario: Card with no tags shows no tag section
  Given a note has no tags
  When  I view the home screen
  Then  no tag pills or "Tags" label appear on the card

Scenario: Tag pills are read-only on the card
  Given a note card shows tag pills
  Then  the pills have no remove button on the home screen

Scenario: Tags update on the card after adding a tag on the note screen
  Given I add a tag "OKRs" on the note screen
  When  I navigate back to the home screen
  Then  the card shows the "OKRs" pill
```

**Acceptance criteria:**

- [ ] `GET /notes/cards` response includes `"tags": [...]` for each card (empty array when no tags)
- [ ] Note cards on the home screen render tag pills below the content snippet
- [ ] Cards with no tags show no tag area
- [ ] Tag pills on cards are display-only (no remove button)
- [ ] E2E: create a note, add tags on the note screen, return home — tag pills visible on the card

---

## Slice 5-D — TagIndex projection and API endpoint

**Status:** Not Started

**Value:** A dedicated `TagIndex` projection captures every tag in use across all notes, with a count and the list of note IDs for each. This is the second projection axis in Phase 5 — a cross-note organisational view built from the same `NoteTagged`/`NoteUntagged` events. The `GET /tags` endpoint exposes it, and 5-E builds the filter UI on top of it. Learning surface: projecting a many-to-many relationship (tags ↔ notes) into a DynamoDB table with a composite key.

**Commands in scope:** none
**Events in scope:** `NoteTagged`, `NoteUntagged`, `NoteDeleted` (already modelled)

**Projections in scope:** `TagIndex` — fully specified in `docs/view-schemas.md`. Storage: table `notetaker-proj-tagindex` (PK: Tag, SK: NoteId). Event handlers:
- `NoteTagged` → put row `(Tag, NoteId, TaggedAt)`
- `NoteUntagged` → delete row
- `NoteDeleted` → delete all rows where `NoteId = …` using a **table scan** (filtered by NoteId). This is a learning project with a tiny dataset; a scan is simpler to implement and sufficient here. No GSI required.

**API endpoint:** `GET /tags` — returns `{ "tags": [{ "tag": "1:1s", "noteCount": 3, "noteIds": [...] }] }` ordered by `noteCount` descending (most-used first), as per `docs/view-schemas.md`.

**CDK changes:** new DynamoDB table `notetaker-proj-tagindex` (PK: `Tag` string, SK: `NoteId` string); new Lambda env var `PROJ_TAGINDEX_TABLE_NAME`; `GrantReadWriteData`. No GSI needed.

**Key implementation files:**
- `src/EventStore/Projections/TagIndexProjection.cs` — new file: `TagIndexEntry`, `TagIndexView`, `ITagIndexStore`, `DynamoDbTagIndexStore`, `TagIndexProjection`
- `src/Api/Handlers/TagHandlers.cs` — new file: `GetTags` handler
- `src/Api/Endpoints/NoteEndpoints.cs` — register `GET /tags`
- `src/Infrastructure/NoteTakerStack.cs` — new CDK table + env var + IAM grant (no GSI)
- `tests/Specs/Projections/TagIndexProjectionSpec.cs` — new spec file
- `tests/ApiIntegration/InMemoryTagIndexStore.cs` — new in-memory implementation
- `tests/InfraAssertions/` — update CDK assertion for new table

**Layer split:** Yes — new projection + CDK table + E2E. Batch 1: projection specs + API integration + CDK assertions. Batch 2: E2E smoke test.

**Scenarios:**

```
Scenario: Tagging a note adds an entry to the TagIndex
  Given no tags exist
  When  NoteTagged { NoteId: A, Tag: "1:1s" } is handled
  Then  GET /tags returns [{ "tag": "1:1s", "noteCount": 1, "noteIds": [A] }]

Scenario: Two notes with the same tag aggregate the count
  Given NoteTagged { NoteId: A, Tag: "1:1s" } and NoteTagged { NoteId: B, Tag: "1:1s" }
  Then  GET /tags returns [{ "tag": "1:1s", "noteCount": 2, "noteIds": [A, B] }]

Scenario: Untagging removes the note from that tag entry
  Given two notes tagged "1:1s"
  When  NoteUntagged { NoteId: A, Tag: "1:1s" }
  Then  GET /tags returns noteCount: 1 for "1:1s", noteIds: [B]

Scenario: Deleting a note removes all its tag entries
  Given note A tagged "1:1s" and "Bill"
  When  NoteDeleted { NoteId: A }
  Then  GET /tags returns [] (both entries removed)

Scenario: Tags are ordered by noteCount descending
  Given tag "rare" on 1 note and tag "common" on 5 notes
  Then  GET /tags returns "common" first
```

**Acceptance criteria:**

- [ ] *(internal)* `TagIndex` projection folds `NoteTagged`, `NoteUntagged`, `NoteDeleted` correctly (BDD spec)
- [ ] *(internal)* `NoteDeleted` cleanup uses a table scan (no GSI); all tag rows for the deleted note are removed
- [ ] *(internal)* CDK template includes `notetaker-proj-tagindex` table with composite key; no GSI
- [ ] `GET /tags` returns all tags with `noteCount` and `noteIds`; empty array when no tags exist
- [ ] Tags are returned ordered by `noteCount` descending
- [ ] `NoteDeleted` removes all tag entries for that note from the projection
- [ ] E2E: create two notes, tag both with "shared", tag one with "unique"; GET /tags — "shared" has count 2, "unique" has count 1

---

## Slice 5-E — Filter by tag on the home screen

**Status:** Not Started

**Value:** Users can click a tag pill anywhere (card or tag list) to filter the Notes section to only notes bearing that tag. This closes the Phase 5 tag loop: tags added in 5-A, visible in 5-B/5-C, indexed in 5-D, now actionable as a filter. Learning surface: client-side filter state derived from a server projection.

**Commands in scope:** none
**Events in scope:** none
**New backend:** none — uses `GET /tags` (5-D) and existing `GET /notes/cards` (which includes tags)

**Filter behaviour:**
- A tag cloud/list appears on the home screen above or below the Notes section (or as a filter bar), populated from `GET /tags`.
- Clicking a tag pill activates a filter; the Notes section re-renders showing only cards whose `tags` array includes the selected tag.
- Multiple tags can be selected. An **AND/OR toggle** controls the matching mode. **Default is AND**: notes bearing **all** selected tags are shown. When switched to OR: notes bearing **any** selected tag are shown.
- An "All" / "Clear filter" control deactivates the filter and resets the toggle to AND.
- Filter state lives in React component state — no URL change, no new API endpoint.

**Key implementation files:**
- `web/src/components/TagFilter.tsx` — new component; receives `tags: TagIndexEntry[]`, `selectedTags: string[]`, `mode: "AND" | "OR"`, `onToggle(tag: string)`, `onModeChange(mode)`; renders clickable tag pills; active tags visually distinct; AND/OR toggle button
- `web/src/components/ListView.tsx` — fetch tags from `GET /tags`; hold `selectedTags` and `filterMode` state; filter `cards` array before passing to `NoteCard` grid; render `<TagFilter>` above notes grid
- `web/src/api.ts` — add `getTags()` returning `TagIndexEntry[]`
- `web/src/App.css` — `.tag-filter`, `.tag-filter-pill`, `.tag-filter-pill--active`, `.tag-filter-mode-toggle`

**Layer split:** No — pure frontend, single batch.

**Scenarios:**

```
Scenario: Tag filter bar shows all tags from the TagIndex
  Given notes tagged "1:1s" and "Bill" exist
  When  I view the home screen
  Then  a filter bar shows pills for "1:1s" and "Bill"

Scenario: Clicking a tag pill filters cards to matching notes only (AND mode)
  Given two notes: one tagged "1:1s", one tagged "Bill"
  When  I click "1:1s" in the filter bar
  Then  only the note tagged "1:1s" appears in the Notes section

Scenario: Selecting two tags in AND mode shows notes matching both
  Given a note tagged "1:1s" and "Bill", and a note tagged only "1:1s"
  When  I select "1:1s" and "Bill" in AND mode
  Then  only the note with both tags is shown

Scenario: Selecting two tags in OR mode shows notes matching either
  Given a note tagged "1:1s" and a note tagged "Bill"
  When  I select "1:1s" and "Bill" in OR mode
  Then  both notes are shown

Scenario: AND/OR toggle defaults to AND
  Given I view the home screen with no filter active
  Then  the AND/OR toggle shows "AND"

Scenario: Clearing the filter restores all cards and resets to AND
  Given a filter is active in OR mode
  When  I click the active tag pill (or a "Clear" control)
  Then  all note cards are shown again and the toggle resets to AND

Scenario: No filter bar when no tags exist
  Given no notes have any tags
  Then  no tag filter bar is shown on the home screen
```

**Acceptance criteria:**

- [ ] Home screen shows a tag filter bar populated from `GET /tags`; hidden when no tags exist
- [ ] Clicking a tag pill filters the Notes section to cards bearing that tag
- [ ] An AND/OR toggle is visible in the filter bar; default is AND
- [ ] In AND mode: multiple selected tags show notes bearing **all** selected tags
- [ ] In OR mode: multiple selected tags show notes bearing **any** selected tag
- [ ] Clicking an active pill deselects it (restoring broader results)
- [ ] Clearing the filter resets both selected tags and mode to AND
- [ ] Filter state resets to "all / AND" on page reload (no persistence needed in this phase)
- [ ] E2E: create two notes tagged differently; activate filter on one tag — only matching card shown; clear — both cards shown; switch to OR mode, select both tags — both cards shown

---

## Slice 5-F — Folder aggregate and sidebar tree

**Status:** Not Started

**Value:** Notes can be organised into named containers. This slice introduces the `Folder` aggregate, `FolderTree` projection, and sidebar tree UI — the structural foundation for 5-G and 5-H. Users can create, rename, and delete folders, and navigate the tree in the sidebar. No note assignment yet — just the tree structure. Learning surface: a second aggregate type with its own event stream and projection.

**Wireframe reference:** `docs/wireframes/Notes in Folder.png` — left sidebar shows a hierarchical folder tree (People > Bill, Amy; Customers > Parcel Force, Gold Train; Projects > API Integration, Anon Auth). Clicking "Bill" under "People" sets the main area heading to "People → Bill" and shows that folder's note cards.

**Commands in scope:**
- `CreateFolder(FolderId, Name, ParentFolderId?)` — name must be non-empty
- `RenameFolder(FolderId, NewName)` — folder exists, name must be non-empty
- `DeleteFolder(FolderId)` — folder exists (cascading behaviour: see 5-H)

**Events in scope:**
- `FolderCreated { FolderId, Name, ParentFolderId? }`
- `FolderRenamed { FolderId, NewName }`
- `FolderDeleted { FolderId }`

**Projections in scope:** `FolderTree` — builds the full hierarchical folder structure.
- Storage: table `notetaker-proj-foldertree` (PK: `FolderId` string, no sort key). Each row stores `FolderId`, `Name`, `ParentFolderId?`, `CreatedAt`.
- `FolderCreated` → put row
- `FolderRenamed` → update Name
- `FolderDeleted` → delete row

**API endpoints:**
- `POST /folders` — body `{ "name": "People", "parentFolderId": null }`; returns 201 with `{ "folderId": "..." }`
- `PATCH /folders/{folderId}/name` — body `{ "name": "..." }`; returns 200
- `DELETE /folders/{folderId}` — returns 204 (cascading delete handled in 5-H; for now, block delete if folder has children — return 409)
- `GET /folders` — returns the full folder tree as a nested JSON structure

**CDK changes:** new DynamoDB table `notetaker-proj-foldertree` (PK: `FolderId` string); new Lambda env var `PROJ_FOLDERTREE_TABLE_NAME`; `GrantReadWriteData`.

**Key implementation files:**
- `src/Domain/Folders/` — new directory: `FolderCommands.cs`, `FolderEvents.cs`, `Folder.cs` (aggregate)
- `src/EventStore/EventDeserializer.cs` — route `FolderCreated`, `FolderRenamed`, `FolderDeleted`
- `src/EventStore/Projections/FolderTreeProjection.cs` — new file: `FolderRow`, `IFolderTreeStore`, `DynamoDbFolderTreeStore`, `FolderTreeProjection`
- `src/Api/FolderCommandHandler.cs` — new command handler
- `src/Api/Handlers/FolderHandlers.cs` — new HTTP handlers
- `src/Api/Endpoints/FolderEndpoints.cs` — register folder endpoints
- `src/Infrastructure/NoteTakerStack.cs` — new CDK table + env var + IAM grant
- `tests/Specs/Folders/FolderSpec.cs` — new BDD spec file
- `tests/ApiIntegration/InMemoryFolderTreeStore.cs` — new in-memory implementation
- `tests/InfraAssertions/` — update CDK assertion for new table
- `web/src/api.ts` — add `createFolder()`, `renameFolder()`, `deleteFolder()`, `getFolders()` returning nested tree
- `web/src/components/Sidebar.tsx` — extend to render the folder tree below the note list; expand/collapse per folder; "New Folder" button; clicking a folder navigates the main area
- `web/src/components/FolderTree.tsx` — new recursive component rendering the nested folder structure
- `web/src/App.css` — `.folder-tree`, `.folder-tree-node`, `.folder-tree-node--expanded`, `.folder-new-btn`

**Layer split:** Yes — new aggregate + projection + CDK + E2E. Batch 1: domain BDD specs + API integration + CDK assertions. Batch 2: E2E + frontend.

**Scenarios:**

```
Scenario: Create a root folder
  Given no folders exist
  When  POST /folders with { "name": "People" }
  Then  FolderCreated { Name: "People", ParentFolderId: null } is appended
  And   GET /folders returns a tree containing "People" at the root

Scenario: Create a nested folder
  Given folder "People" exists with folderId P
  When  POST /folders with { "name": "Bill", "parentFolderId": P }
  Then  FolderCreated { Name: "Bill", ParentFolderId: P } is appended
  And   GET /folders returns "Bill" as a child of "People"

Scenario: Rename a folder
  Given folder "Peopl" exists (typo)
  When  PATCH /folders/{folderId}/name with { "name": "People" }
  Then  FolderRenamed { NewName: "People" } is appended
  And   GET /folders returns the corrected name

Scenario: Delete an empty folder
  Given folder "People" exists with no children
  When  DELETE /folders/{folderId}
  Then  FolderDeleted is appended
  And   GET /folders no longer contains "People"

Scenario: Delete a folder that has children returns 409
  Given folder "People" has child folder "Bill"
  When  DELETE /folders/{folderId} for "People"
  Then  409 Conflict is returned and FolderDeleted is not appended

Scenario: Sidebar renders folder tree
  Given folders "People > Bill" and "Projects" exist
  When  I view the home screen
  Then  the sidebar shows "People" collapsed, and "Projects" at the root

Scenario: Expanding a folder in the sidebar reveals its children
  Given folder "People" has children "Bill" and "Amy"
  When  I click to expand "People" in the sidebar
  Then  "Bill" and "Amy" appear indented under "People"
```

**Acceptance criteria:**

- [ ] *(internal)* `Folder` aggregate folds `FolderCreated`, `FolderRenamed`, `FolderDeleted`; `CreateFolder` with empty name throws; `DeleteFolder` when children exist returns 409 from the API
- [ ] *(internal)* `FolderTree` projection folds `FolderCreated`, `FolderRenamed`, `FolderDeleted` correctly
- [ ] *(internal)* CDK template includes `notetaker-proj-foldertree` table
- [ ] `POST /folders` creates a folder; `GET /folders` returns it in the tree
- [ ] `PATCH /folders/{folderId}/name` renames the folder
- [ ] `DELETE /folders/{folderId}` on a folder with children returns 409; on an empty folder deletes it
- [ ] `GET /folders` returns a nested tree structure representing parent/child relationships
- [ ] Sidebar renders the folder tree with expand/collapse; "New Folder" button creates a root folder
- [ ] Clicking a folder in the sidebar changes the main view heading to the folder path (e.g. "People → Bill")
- [ ] E2E: create folders "People" and child "Bill"; expand "People" in sidebar; click "Bill"; main area shows "People → Bill"

---

## Slice 5-G — File notes in folders

**Status:** Not Started

**Value:** Notes can be filed into folders via drag and drop in the sidebar. The home screen "Unfiled" section shows only notes not in any folder. Clicking a folder in the sidebar shows the note cards for that folder. This is the payoff slice for 5-F — the folder tree is now populated with notes.

**Commands in scope:**
- `MoveNoteToFolder(NoteId, FolderId)` — note exists, folder exists → `NoteFiledInFolder { NoteId, FolderId }`
- `UnfileNote(NoteId)` — note exists, note is in a folder → `NoteUnfiled { NoteId }`

**Events in scope:**
- `NoteFiledInFolder { NoteId, FolderId }` — new event on `Note` aggregate
- `NoteUnfiled { NoteId }` — new event on `Note` aggregate

**Projections in scope:**
- `NoteCardList` — extend with `FolderId?` field; handlers for `NoteFiledInFolder` (set FolderId) and `NoteUnfiled` (clear FolderId)
- `FolderTree` — no change (folder structure already correct)

**API endpoints:**
- `PUT /notes/{noteId}/folder` — body `{ "folderId": "..." }`; returns 204; 404 if note or folder not found
- `DELETE /notes/{noteId}/folder` — returns 204 (unfiles the note); 404 if note not in a folder
- `GET /notes/cards?folderId={folderId}` — returns only cards in the given folder
- `GET /notes/cards?unfiled=true` — returns only unfiled cards

**Key implementation files:**
- `src/Domain/Notes/NoteCommands.cs` — add `MoveNoteToFolder`, `UnfileNote`
- `src/Domain/Notes/NoteEvents.cs` — add `NoteFiledInFolder`, `NoteUnfiled`
- `src/Domain/Notes/Note.cs` — add `_folderId` state; `Apply(NoteFiledInFolder)`, `Apply(NoteUnfiled)`, `HandleMoveNoteToFolder`, `HandleUnfileNote`
- `src/EventStore/EventDeserializer.cs` — route `NoteFiledInFolder`, `NoteUnfiled`
- `src/EventStore/Projections/NoteCardListProjection.cs` — add `FolderId?` to `NoteCardView`; add handlers
- `src/Api/NoteCommandHandler.cs` — add `HandleAsync(MoveNoteToFolder)`, `HandleAsync(UnfileNote)`
- `src/Api/Handlers/NoteHandlers.cs` — add HTTP handlers for file/unfile; extend `GET /notes/cards` to accept `folderId` and `unfiled` query params
- `src/Api/Endpoints/NoteEndpoints.cs` — register new endpoints
- `tests/Specs/Notes/MoveNoteToFolderSpec.cs` — new BDD spec file
- `tests/ApiIntegration/InMemoryNoteCardListStore.cs` — extend to filter by folderId / unfiled
- `web/src/api.ts` — add `moveNoteToFolder()`, `unfileNote()`, update `getNoteCards()` to accept optional filter params
- `web/src/components/Sidebar.tsx` — add drag-and-drop: drag a note name from sidebar onto a folder node to file it; drop onto root or "Unfiled" area to unfile
- `web/src/components/ListView.tsx` — home screen "Unfiled" section shows `GET /notes/cards?unfiled=true`; folder view shows `GET /notes/cards?folderId=xxx`
- `web/src/App.css` — drag-over highlight styles for folder nodes

**Layer split:** Yes — new events + projection extension + API changes + E2E. Batch 1: domain BDD specs + API integration. Batch 2: E2E + frontend drag-and-drop.

**Scenarios:**

```
Scenario: File a note into a folder
  Given note N and folder F exist
  When  PUT /notes/N/folder with { "folderId": F }
  Then  NoteFiledInFolder { NoteId: N, FolderId: F } is appended
  And   GET /notes/cards?folderId=F includes note N
  And   GET /notes/cards?unfiled=true does not include note N

Scenario: Unfile a note from its folder
  Given note N is filed in folder F
  When  DELETE /notes/N/folder
  Then  NoteUnfiled { NoteId: N } is appended
  And   GET /notes/cards?unfiled=true includes note N

Scenario: Home screen Unfiled section shows only unfiled notes
  Given note A is unfiled and note B is filed in folder F
  When  I view the home screen
  Then  note A appears in the Unfiled section
  And   note B does not appear in the Unfiled section

Scenario: Clicking a folder in the sidebar shows its notes
  Given note B is filed in folder "Bill" under "People"
  When  I click "Bill" in the sidebar
  Then  the main area shows "People → Bill" and only note B's card

Scenario: Drag a note onto a folder in the sidebar to file it
  Given note A is unfiled and folder "Projects" exists
  When  I drag note A from the sidebar onto "Projects"
  Then  note A is filed in "Projects"
  And   note A no longer appears in the Unfiled section
```

**Acceptance criteria:**

- [ ] *(internal)* `Note` aggregate handles `MoveNoteToFolder` and `UnfileNote`; fires correct events
- [ ] *(internal)* `NoteCardList` projection folds `NoteFiledInFolder` and `NoteUnfiled`
- [ ] `PUT /notes/{noteId}/folder` files a note; `GET /notes/cards?folderId=xxx` returns it; `?unfiled=true` does not
- [ ] `DELETE /notes/{noteId}/folder` unfiles a note; it reappears in `?unfiled=true`
- [ ] Home screen "Unfiled" section shows only notes with no folder
- [ ] Filed notes do **not** appear in the unfiled main list
- [ ] Clicking a folder in the sidebar shows the correct note cards for that folder
- [ ] Drag-and-drop in the sidebar files a note into the target folder
- [ ] E2E: create note and folder; drag note onto folder in sidebar; verify note appears under folder and not in unfiled list; drag back to root — note reappears as unfiled

---

## Slice 5-H — Move and nest folders

**Status:** Not Started

**Value:** The folder tree is fully malleable — users can drag a folder onto another folder to reparent it. Cascading delete is handled. This is the most structurally complex slice in Phase 5: reparenting changes the tree shape, and the cascade policy must be explicit.

**Commands in scope:**
- `MoveFolder(FolderId, NewParentFolderId?)` — move a folder to a new parent (or to root if `NewParentFolderId` is null); must not create a cycle (moving a folder into one of its own descendants is forbidden)

**Events in scope:**
- `FolderMoved { FolderId, NewParentFolderId? }`

**Projections in scope:**
- `FolderTree` — add handler for `FolderMoved`; update `ParentFolderId` on the row

**Cascading delete policy (proposed — confirm with human before implementing):**
When `DeleteFolder` is called on a folder that has children: **automatically unfile all notes in the folder and all descendant folders, then delete all descendant folders, then delete the target folder**. This produces a sequence of `NoteUnfiled` events (one per filed note in the subtree) followed by `FolderDeleted` events (bottom-up) ending with `FolderDeleted` for the target. The trade-off: simple for the user ("delete always works"), but the event log grows proportionally to the subtree size. The alternative — blocking delete if children exist (current 5-F behaviour) — is safer but forces the user to manually clean up. The cascade approach is recommended for a meeting notes tool where empty folders are rarely the goal.

**Cycle prevention:** `MoveFolder` must validate that `NewParentFolderId` is not the folder itself or any of its descendants. This requires the command handler (or aggregate, with ancestry passed in) to check the current tree state.

**API endpoints:**
- `PUT /folders/{folderId}/parent` — body `{ "parentFolderId": "..." }` or `{ "parentFolderId": null }` to move to root; returns 200; 400 if cycle detected; 404 if folder or parent not found

**Key implementation files:**
- `src/Domain/Folders/FolderCommands.cs` — add `MoveFolder`
- `src/Domain/Folders/FolderEvents.cs` — add `FolderMoved`
- `src/Domain/Folders/Folder.cs` — add `Apply(FolderMoved)`, `HandleMoveFolder` (cycle check receives ancestry list from handler)
- `src/EventStore/EventDeserializer.cs` — route `FolderMoved`
- `src/EventStore/Projections/FolderTreeProjection.cs` — add `FolderMoved` handler; update cascading delete logic
- `src/Api/FolderCommandHandler.cs` — extend to handle `MoveFolder` (loads tree to check ancestry); update `DeleteFolder` to cascade (unfile notes, delete descendants)
- `src/Api/Handlers/FolderHandlers.cs` — add `PUT /folders/{folderId}/parent` handler; update `DELETE` handler
- `src/Api/Endpoints/FolderEndpoints.cs` — register `PUT /folders/{folderId}/parent`
- `tests/Specs/Folders/MoveFolderSpec.cs` — new BDD spec file (covers reparenting + cycle detection)
- `tests/Specs/Folders/DeleteFolderCascadeSpec.cs` — new BDD spec file (covers cascading delete)
- `web/src/components/Sidebar.tsx` — add drag-folder-onto-folder to call `moveFolder()`; drop onto root area to move to root
- `web/src/App.css` — drag-over highlight for folder nodes when dragging a folder

**Layer split:** Yes — new command + new event + projection update + cascade logic + E2E. Batch 1: domain BDD specs + API integration. Batch 2: E2E + frontend drag-folder.

**Scenarios:**

```
Scenario: Move a folder to a new parent
  Given folders "People" (P) and "Projects" (Q) and child "Bill" (B, parent P)
  When  PUT /folders/B/parent with { "parentFolderId": Q }
  Then  FolderMoved { FolderId: B, NewParentFolderId: Q } is appended
  And   GET /folders shows "Bill" as a child of "Projects", not "People"

Scenario: Move a folder to root
  Given folder "Bill" (B) is a child of "People"
  When  PUT /folders/B/parent with { "parentFolderId": null }
  Then  FolderMoved { FolderId: B, NewParentFolderId: null } is appended
  And   GET /folders shows "Bill" at the root

Scenario: Moving a folder into one of its own descendants is rejected
  Given folder "People" (P) has child "Bill" (B)
  When  PUT /folders/P/parent with { "parentFolderId": B }
  Then  400 Bad Request is returned and no FolderMoved is appended

Scenario: Deleting a folder with children unfiles notes and deletes descendants
  Given folder "People" (P) has child "Bill" (B); note N is filed in B
  When  DELETE /folders/P
  Then  NoteUnfiled { NoteId: N } is appended
  And   FolderDeleted { FolderId: B } is appended
  And   FolderDeleted { FolderId: P } is appended
  And   GET /folders no longer contains "People" or "Bill"
  And   note N appears in GET /notes/cards?unfiled=true

Scenario: Drag a folder onto another folder in the sidebar
  Given folder "Bill" is under "People" in the sidebar
  When  I drag "Bill" onto "Projects"
  Then  "Bill" appears under "Projects" and is no longer under "People"
```

**Acceptance criteria:**

- [ ] *(internal)* `MoveFolder` appends `FolderMoved`; `FolderTree` projection updates parent correctly
- [ ] *(internal)* Moving a folder into its own descendant returns 400
- [ ] *(internal)* `DeleteFolder` with descendants: unfiles all notes in the subtree, deletes all descendant folders bottom-up, then deletes the target folder; all events appended atomically per folder
- [ ] `PUT /folders/{folderId}/parent` reparents the folder; `GET /folders` reflects the new tree shape
- [ ] `PUT /folders/{folderId}/parent` with a cycle returns 400
- [ ] `DELETE /folders/{folderId}` on a folder with children cascades: notes unfile, descendants delete, then target deletes
- [ ] Drag-folder-onto-folder in the sidebar reparents the folder
- [ ] E2E: create "People > Bill"; drag "Bill" onto "Projects"; verify tree shape; drag back to root; verify "Bill" at root

---

## Deferred to backlog (raised during Scout pass)

The following ideas surfaced during Phase 5 planning and are explicitly out of scope here. Added to `docs/backlog.md` when the phase is kicked off.

- **Tag suggestions as you type** — `TagIndex` projection powers an autocomplete dropdown in the tag input. Already noted in `docs/event-model.md` as a Phase 4+ enhancement. The projection is now in place; the UI sugar is deferred.
- **Tag rename / merge** — renaming a tag across all notes requires a new command or a projection-only migration. Out of scope for Phase 5; model evolution is a Phase 6+ concern.
- **"Close Note" replaces "← Back"** — deferred from Phase 4. Still deferred; not related to tagging or folders.
- **Touch target accessibility pass** — deferred from Phase 4. Still deferred.
- **Delete action item from home screen** — deferred from Phase 3. Still deferred.
- **Folder-scoped tag filter** — when viewing a folder's notes, the tag filter bar should only show tags present in that folder's cards. Deferred; the global filter is sufficient for Phase 5.
- **Folder colour / icon** — visual differentiation between folders in the tree. Deferred; naming is sufficient for Phase 5.
