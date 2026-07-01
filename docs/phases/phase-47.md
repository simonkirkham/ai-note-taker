# Phase 47 — Folder administration via the MCP _(In Progress — 47-A done 2026-07-01)_

**Goal:** You can have Claude create, rename, delete, and reorganise folders and file notes into them straight from the MCP connector — folder admin that until now needed the web app.

## Summary

| Slice | What the user gets | Status | Depends on |
|-------|--------------------|--------|------------|
| 47-A | Claude lists a workspace's folders and creates new ones | Done _(#385, deploy #689)_ | — |
| 47-B | Claude files a note into a folder (and moves it between folders) | Not Started | 47-A |
| 47-C | Claude renames and deletes folders | Not Started | 47-A |
| 47-D | Claude reparents a folder to reorganise the tree | Not Started | 47-C |

> 47-A is the thin vertical that proves the whole Claude→folder pipe on one real create and makes the result visible (list); it establishes the identity-explicit folder-write contract the other write slices reuse. 47-B reuses the existing note-filing path, so it's independent of the folder-write work. 47-C scales the proven pattern; 47-D is optional and can land last.

## Slices

### Slice 47-A — List and create folders

- **User value:** Claude can see how your notes are organised and set up new folders for you, without you opening the app.
- **How it works:**
  - You ask Claude (e.g. "make a folder called Clients in my OGI workspace"); Claude finds the workspace and creates the folder.
  - Claude can also list a workspace's folders — each folder's name and where it sits in the tree — to reference or confirm.
  - A folder created via Claude shows up in the web app's sidebar, and folders made in the app show up to Claude — one shared folder tree.
  - Claude can only touch workspaces you own.
- **Scenarios (GWT):**

```
Scenario: create a folder in an owned workspace
  Given I own the workspace "OGI"
  When  Claude creates a folder "Clients" in it
  Then  the folder exists and appears in that workspace's folder list

Scenario: create a subfolder
  Given a folder "Clients" exists
  When  Claude creates "Acme" under "Clients"
  Then  "Acme" appears nested under "Clients"

Scenario: list a workspace's folders
  Given the workspace has "Clients" and "Clients/Acme"
  When  Claude lists the folders
  Then  it sees both, with "Acme" shown as a child of "Clients"

Scenario: create in a workspace I don't own
  Given a workspace I do not own
  When  Claude tries to create a folder in it
  Then  the call is rejected and no folder is created
```

### Slice 47-B — File a note into a folder

- **User value:** Claude can tidy your notes away into the right folder for you.
- **How it works:**
  - You ask Claude to file a note (e.g. "put the Acme kickoff note in the Clients folder"); Claude moves the note into that folder.
  - A note lives in exactly one folder (or none); re-filing it just moves it.
  - The change shows immediately in the web app.
  - Claude can only file notes you own, into folders you own.
- **Scenarios (GWT):**

```
Scenario: file a note into a folder
  Given a note and a folder in a workspace I own
  When  Claude files the note into the folder
  Then  the note appears in that folder

Scenario: move a note to a different folder
  Given a note already filed in folder A
  When  Claude files it into folder B
  Then  the note is in B and no longer in A

Scenario: file a note I don't own
  Given a note in a workspace I don't own
  When  Claude tries to file it
  Then  the call is rejected and nothing moves
```

### Slice 47-C — Rename and delete folders

- **User value:** Claude can keep your folder names tidy and clear out folders you no longer need.
- **How it works:**
  - You ask Claude to rename or delete a folder; Claude does it against a folder you own.
  - Deleting a folder deletes it and everything nested inside it; any notes filed there become unfiled — they aren't deleted, just returned to "no folder".
  - Changes show immediately in the web app.
- **Scenarios (GWT):**

```
Scenario: rename a folder
  Given a folder "Clients" I own
  When  Claude renames it to "Key Clients"
  Then  the folder's name is "Key Clients" everywhere

Scenario: delete a folder and its contents
  Given "Clients" with a subfolder "Acme" and a note filed in "Clients"
  When  Claude deletes "Clients"
  Then  "Clients" and "Acme" are gone and the note is unfiled (not deleted)

Scenario: rename or delete a folder I don't own
  Given a folder in a workspace I don't own
  When  Claude tries to rename or delete it
  Then  the call is rejected and nothing changes
```

### Slice 47-D — Reparent a folder _(optional)_

- **User value:** Claude can reorganise your folder tree — move a whole folder, with its contents, under a different parent.
- **How it works:**
  - You ask Claude to move a folder under another one (or up to the top level); the folder and everything in it move together.
  - You can't move a folder into itself or into one of its own subfolders (that would make a loop) — Claude is told no and nothing moves.
- **Scenarios (GWT):**

```
Scenario: move a folder under a new parent
  Given folders "Acme" and "Key Clients" I own
  When  Claude moves "Acme" under "Key Clients"
  Then  "Acme", with its contents, appears nested under "Key Clients"

Scenario: move a folder to the top level
  Given "Acme" nested under "Key Clients"
  When  Claude moves "Acme" to no parent
  Then  "Acme" is a top-level folder

Scenario: reject a move that would create a cycle
  Given "Acme" nested under "Key Clients"
  When  Claude tries to move "Key Clients" under "Acme"
  Then  the call is rejected and the tree is unchanged
```

---

## Build notes _(implementation — skip when reviewing)_

### Cross-cutting (all slices)

- **Identity-explicit folder-command overload (the key contract, established in 47-A).** `IFolderCommandHandler` (`src/Api/CommandHandlers/`) today has only route-coupled `HandleAsync(cmd, ct)` using `ICurrentUser`/`ICurrentWorkspace`. Add an identity-explicit overload per command — `HandleAsync(CreateFolder cmd, string userId, string? workspaceId, ct)` (+ Rename/Delete/Move) — mirroring `INoteCommandHandler` (33-B2). Behaviour-preserving; existing HTTP folder paths call the route-coupled overload unchanged. **Not** a new `IFolderScope` (Phase 42's `ICalendarScope` solved per-provider calendar resolution; folders need none — the simpler note-handler overload fits).
- **Tools:** new `[McpServerTool]` methods (on `NoteMcpTools`, or a sibling `FolderMcpTools` if cleaner), each taking `workspaceId`, authorizing via `AuthorizeWriteAsync`/`AuthorizeAsync(tool, workspaceId, ct)` → `userId`, then calling the identity-explicit handler (writes) or reading `IFolderTreeStore` (list). Descriptions stay one terse line.
- **Tool-count cap:** 13/13 today (the Phase-42 documented cap; **not** code-enforced). This phase adds up to 5 (`list_folders`, `create_folder`, `rename_folder`, `delete_folder`, `move_note_to_folder`) + `move_folder` (47-D) → ~18–19. **Decision to lock at scoping:** raise the documented cap to ~19 and keep distinct, self-describing tools, vs. a single consolidated `manage_folder(action, …)`. Recommend distinct tools; revisit if the larger toolset degrades model behaviour.
- **Folder-ownership authorization (BUG-41 lesson).** Workspace ownership (`AuthorizeWriteAsync`) is necessary but **not** sufficient for rename/delete/move of a *specific* folder — owning any folder id + a foreign target must not mutate it. Bind the op to the folder's own `(UserId, WorkspaceId)`. **BUG-30 caveat:** folder writes run on the Command Lambda; do **not** authorize against the *async* FolderTree projection (it can 404 a just-created folder). Use an event-stream folder-ownership check (mirror `IActionItemAuthorizer.OwnsActionAsync`) or gate on the same stream. `create_folder` (47-A) needs only workspace ownership (no pre-existing folder).
- **Infra: neutral.** `/mcp` is on the Command Lambda (41-A); `IFolderCommandHandler`, `IFolderTreeStore`, and `INoteCommandHandler` are all already granted there. No new routes/tables/compute, no CDK change (same as Phase 42).

### 47-A — `list_folders` + `create_folder`

- **Commands/events:** reuse `CreateFolder`→`FolderCreated` (Phase 5). No new events.
- **Tools:** `list_folders(workspaceId)` (read) → filter `IFolderTreeStore` to the caller's `(userId, workspaceId)`, return `[{ id, name, parentId }]` (tree via `parentId`). `create_folder(workspaceId, name, parentId?)` (write) → `AuthorizeWriteAsync` → `HandleAsync(new CreateFolder(new FolderId(Guid.NewGuid()), name, parentId, now), userId, workspaceId, ct)`.
- **Overload:** add the identity-explicit `IFolderCommandHandler` overloads here (all four commands, so 47-C/D reuse them).
- **Read model:** `FolderTreeView` (`FolderId`, `Name`, `ParentFolderId`, `UserId`, `WorkspaceId`). No note counts in v1 — the view carries none; adding them is a projection change, **deferred** as an enhancement.
- **Tests (Api.Integration, mirror `McpActionItemWriteToolsTests`):** create in owned ws → appears via `list_folders`; subfolder → nested; create in unowned ws → tool error, nothing created; blank/whitespace name → rejected; `list_folders` returns only the caller's folders in that ws.
- **Acceptance criteria:**
  - [ ] `create_folder`/`list_folders` on `/mcp`, workspace-authorized.
  - [ ] Identity-explicit `IFolderCommandHandler` overloads added; existing HTTP folder tests stay green.
  - [ ] A folder created via MCP appears in the web sidebar (shared FolderTree).
  - [ ] Cross-workspace create rejected, stamps nothing.

### 47-B — `move_note_to_folder`

- **Commands/events:** reuse the **Note** command `MoveNoteToFolder`→`NoteFiledInFolder` (Phase 5). No new events. (Filing is note-aggregate state, not a folder command.)
- **Tool:** `move_note_to_folder(workspaceId, noteId, folderId)` → authorize the note's ownership (existing note auth) **and** the target folder's ownership → `INoteCommandHandler.HandleAsync(new MoveNoteToFolder(noteId, folderId), userId, workspaceId, ct)` (note handler's identity-explicit overload already exists — reuses the 41-A path). Mirrors HTTP `POST /w/{wsId}/notes/{noteId}/file-in-folder`.
- **Tests:** file → in folder; re-file → moved out of A into B; foreign note → rejected; foreign target folder → rejected.
- **Acceptance criteria:**
  - [ ] Files/moves a note via the existing note command path.
  - [ ] Authorizes **both** the note and the target folder to the caller.

### 47-C — `rename_folder` + `delete_folder`

- **Commands/events:** reuse `RenameFolder`→`FolderRenamed`, `DeleteFolder`→`FolderDeleted` (Phase 5). No new events. Delete keeps the existing handler's cascade (descendants deleted bottom-up, filed notes unfiled).
- **Tools:** `rename_folder(workspaceId, folderId, name)`; `delete_folder(workspaceId, folderId)`. Both authorize **folder ownership** via the event-stream check (see cross-cutting).
- **Tests:** rename → name changes everywhere; delete → folder + subfolders gone, filed notes unfiled (not deleted); rename/delete foreign folder → rejected; delete a non-empty tree → cascade correct.
- **Acceptance criteria:**
  - [ ] rename/delete authorize the folder's own owner (BUG-41 binding), not just the workspace.
  - [ ] delete cascades exactly as the web path does (descendants gone, notes unfiled).

### 47-D — `move_folder` (reparent) _(optional; can land last)_

- **Commands/events:** reuse `MoveFolder`→`FolderMoved` (Phase 5). No new events. The aggregate's cycle-detection rejects moving a folder into its own descendant.
- **Tool:** `move_folder(workspaceId, folderId, newParentId?)`; authorize folder ownership.
- **Tests:** reparent → nested under new parent; `newParentId=null` → top-level; move into own descendant → rejected (cycle), tree unchanged; foreign folder → rejected.
- **Acceptance criteria:**
  - [ ] reparent works and rejects cycles; foreign-folder move rejected.

### Observability (silent failure modes — provisional; Scout re-runs observability-brief at pickup)

- **Write succeeds but `list_folders` lags** — FolderTree is projector-built (async). A tool returns success, then a `list_folders` that lags reads stale → looks broken. Return a consistency token from the write tools (as HTTP folder writes do) and/or note eventual consistency; log `mcp_folder_write ok tool=… folderId=… version=…`.
- **Auth rejections** — extend the existing `mcp_write_rejected`/`mcp_read_rejected` (tool, sub, workspaceId, reason) to the folder tools; a spike = a mis-scoped client or an attempted cross-user op.
- **Delete cascade partial failure** — a delete that removes the folder but fails mid-unfile orphans filed notes onto a dead folder. Log descendants-deleted + notes-unfiled counts; the op must be atomic or surface a clear error, never a partial silent success.
- **Cross-stream lag on `move_note`** — the note's folder is note-stream state; folder existence is folder-stream state. Authorizing the target folder against the async FolderTree while the write is on the note stream is a BUG-30/cross-stream race — authorize folder ownership from the event stream on the Command Lambda.
- **Silent no-op on a bad/foreign `folderId`** — rename/delete/move/file against a non-existent or foreign folder must return a clear tool error, not a silent success.

### Deploy-time impact

- **Neutral.** New tools on the existing `/mcp` endpoint + identity-explicit handler overloads — no new routes, tables, or always-on compute, no CDK change. Same profile as Phase 42.

### Scoping decisions

1. **Identity-explicit folder overload** (note-handler style), not a new `IFolderScope`. _(Recommend.)_
2. **`list_folders` returns no note counts in v1** (view has none; a projection change is deferred). _(Recommend; revisit if the model wants counts.)_
3. **Tool-count cap → ~19, distinct tools** vs. a consolidated `manage_folder`. _(To confirm with owner.)_
4. **`move_note_to_folder` belongs in this phase** (a Note command, but it's the folder-filing capability). _(Recommend.)_
5. **`move_folder` (47-D) is optional** — reparent + cycle-detection; ships value without it. _(Recommend.)_

**Learning surface:** extending the MCP-write pattern to a **third** aggregate (after notes + action items); adding an identity-explicit overload to a route-coupled handler; folder-ownership authorization against the event stream (BUG-41 + BUG-30 together).
