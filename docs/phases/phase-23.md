# Phase 23 — Workspaces

**Goal:** Let a user partition their content into named **workspaces** (e.g. *Work* / *Personal*) and switch between them, with full per-workspace isolation of notes, folders, tags, to-dos, and search. Workspace membership is **domain state on the Note aggregate** — a `NoteAssignedToWorkspace` event modelled on the existing `NoteFiledInFolder` pattern — so a note created in the wrong workspace can be **moved**. Calendar/meetings stay global (one Google calendar per user); a note created from a meeting lands in the active workspace. Graduated from the "Workspaces" idea in `future-features.md`.

## Summary

| Slice | Summary | Status | Depends on |
|-------|---------|--------|------------|
| 23-A | **Workspace aggregate + list + CRUD API + default workspace.** `Workspace` aggregate (create/rename/delete), `WorkspaceList` projection + table, `/workspaces` endpoints, reserved non-deletable default "Personal". No content scoping yet. | Done | — |
| 23-B | **Scope the write path + note read models.** `EventMetadata.WorkspaceId`; `/w/{wsId}` route group + rootless→default fallback; context reads & validates `wsId`; `NoteAssignedToWorkspace` on create; scope NoteCard/NoteDetail/NoteTitleList/NoteSearch/TagIndex/NoteActions by (user, workspace) with `null→default`. | Done | 23-A |
| 23-C | **Scope folders + to-dos; enforce delete-if-empty.** FolderTree + TodoList gain a workspace dimension; `DeleteWorkspace` blocked when the workspace holds any active note. | Done | 23-B |
| 23-D | **Frontend workspace routing + context.** `/w/:wsId` routes, `/`→`/w/{default}` redirect, `WorkspaceContext` from route params, api-client path injection, query keys gain `wsId`, cache reset on switch. Single (default) workspace, fully prefix-routed. | Not Started | 23-B |
| 23-E | **Workspace switcher + CRUD UI** *(prototype first)*. Sidebar switcher, create/rename/delete workspace, navigate between workspaces. Multi-workspace usable end to end. | Not Started | 23-D |
| 23-F | **Move a note to another workspace.** `MoveNoteToWorkspace` → `NoteAssignedToWorkspace` (+ `NoteUnfiled` if filed); re-bucket all note-derived read models; move control on note/card; optimistic removal from the current view. | Not Started | 23-B, 23-E |
| 23-G | **Cleanup + backfill.** Remove rootless fallback routes; verify `ProjectionRebuildHandler` + `null→default`; post-deploy projection backfill; learnings. | Not Started | 23-C, 23-E, 23-F |

> **23-A** is independently shippable (no UI). **23-B is the keystone** — it sets the metadata/route-group/assignment-event conventions every later slice copies. The **rootless→default fallback** in 23-B/23-C keeps the unchanged frontend working until 23-D adopts the prefix, so each backend slice ships green. 23-D…23-F are the frontend arc.

**Learning surface (secondary):** a second isolation dimension retrofitted across an event-sourced system (contrast the Phase 8 `UserId` retrofit); container-membership-as-event vs as-field (the `NoteFiledInFolder` precedent reused); a reserved-sentinel default that lets immutable history map forward without a log rewrite; URL-addressed resource scoping on both the API and an SPA router.

---

## Design decisions (locked)

| # | Decision | Choice & rationale |
|---|----------|--------------------|
| 1 | Workspace conveyed to API | **URL path prefix** `/w/{wsId}/…` via an ASP.NET route group; context reads `wsId` from the route and validates it belongs to the caller (else `404`). |
| 2 | Where note workspace lives | **Domain state** via `NoteAssignedToWorkspace { NoteId, WorkspaceId }` (latest-wins), folded on the Note aggregate exactly like `NoteFiledInFolder`. Emitted on create and on move. **No create-event versioning.** |
| 3 | Where folder/to-do workspace lives | **`EventMetadata.WorkspaceId`** (nullable, backward-compatible JSON add). Folders and standalone to-dos are not movable, so per-event metadata is sufficient and avoids versioning `FolderCreated`/`TodoAdded`. |
| 4 | Default workspace | Reserved id **`__default__`**, name "Personal" (renameable), auto-materialised in `WorkspaceList`, **never deletable**. Mirrors the `__unfiled__` folder sentinel. |
| 5 | Historical (unassigned) data | `WorkspaceId == null` (no assignment event / no metadata) **resolves to `__default__`** in every projection. **No event-log migration** — immutability preserved. |
| 6 | Movable in v1 | **Notes only.** Moving a note also **clears its folder** (emit `NoteUnfiled` alongside `NoteAssignedToWorkspace`) — `folderId` is workspace-local. Folder/to-do move is a future additive slice. |
| 7 | Delete a non-empty workspace | **Blocked** — `DeleteWorkspace` rejects (`409`) if the workspace holds any active note. Default workspace can never be deleted. |
| 8 | To-Do list + tag filters | **Per-workspace.** `TodoList`/`TagIndex` gain a workspace dimension; switching changes both. |

### What is global vs per-workspace

| Per-workspace | Global (per user) |
|---|---|
| Notes, NoteCards, NoteDetail, NoteTitleList | Calendar / meetings (one Google calendar) |
| Folders (FolderTree) | Workspace list itself (`/workspaces`) |
| Tags (TagIndex) | AI feedback projections (Tag/ActionItem feedback) |
| To-dos + note action items (TodoList) | Transcription credentials, auth, admin rebuild |
| Search (NoteSearchView) | |

> A note **created from a meeting** is created in the **active** workspace (the meetings list is global; the create call is workspace-addressed).

### Sequencing note — Phase 20

Note cards and `useNotes` are **still hand-rolled** (Phase 20-C/E not done), so 23-D threads `wsId` through hand-rolled state as well as TanStack keys. This phase is **cleaner after 20-C/E land** but is not blocked by them — call out the extra hand-rolled wiring in 23-D's Refactor.

---

## New events & commands

**Workspace aggregate (new):**

| Command | Pre-conditions | Event |
|---|---|---|
| `CreateWorkspace(workspaceId, name, createdAt)` | id does not exist | `WorkspaceCreated { WorkspaceId, Name }` |
| `RenameWorkspace(workspaceId, newName, renamedAt)` | exists; name differs | `WorkspaceRenamed { WorkspaceId, NewName }` |
| `DeleteWorkspace(workspaceId, deletedAt)` | exists; not the default; **no active note assigned** | `WorkspaceDeleted { WorkspaceId }` |

**Note aggregate (additive):**

| Command | Pre-conditions | Event(s) |
|---|---|---|
| `MoveNoteToWorkspace(noteId, targetWorkspaceId)` | note active; target exists; target ≠ current | `NoteAssignedToWorkspace { NoteId, WorkspaceId }` (+ `NoteUnfiled` if currently filed) |

`NoteAssignedToWorkspace` is **also** emitted by `CreateNote` (assign to the route's workspace). Aggregate folds `_workspaceId` (default `__default__`). No existing event shape changes.

---

## Slices

### Slice 23-A — Workspace aggregate, list, CRUD API + default workspace

**User value:** A user can create, rename, and delete named workspaces (no content scoping yet — foundation).

**Scenarios (GWT):**
- Given no workspaces, when I `GET /workspaces`, then I see exactly the default "Personal" workspace (`__default__`).
- Given the default workspace, when I `POST /workspaces {name:"Work"}`, then a new workspace with a generated id is returned and listed.
- Given a workspace "Work", when I `PATCH /workspaces/{id} {name:"Clients"}`, then its name updates.
- Given a workspace, when I `DELETE /workspaces/{id}`, then it is removed from the list.
- Given the default workspace, when I `DELETE /workspaces/__default__`, then `409` (default is non-deletable).
- Given another user's workspace id, when I act on it, then `404` (per-user isolation).

**Acceptance criteria:**
- `Workspace` aggregate is pure; `WorkspaceCreated/Renamed/Deleted` events; `WorkspaceCommandHandler` wired inline + in `ProjectionRebuildHandler`.
- `WorkspaceList` projection in a new DynamoDB table (CDK + Infrastructure.Assertions for env var + deletion policy).
- Default workspace synthesised by the projection when absent; never deletable.
- Endpoints `RequireAuthorization`; scoped by `UserId`.
- BDD spec (Domain.Specs) + Api.Integration tests green.

### Slice 23-B — Scope the write path + note read models

**User value:** None directly — every note write now records its workspace; note reads are workspace-filtered. App still runs in the default workspace.

**Scenarios (GWT):**
- Given I create a note under `/w/{ws}/notes`, when it is stored, then `NoteAssignedToWorkspace { ws }` is appended and `EventMetadata.WorkspaceId == ws`.
- Given a note in workspace A, when I list cards under `/w/B/notes/cards`, then it is absent.
- Given a historical note with no assignment event, when I list cards under `/w/__default__/...`, then it appears (`null→default`).
- Given a request to `/w/{ws}` where `ws` is not mine, then `404`.
- Given the rootless `/notes/cards` (fallback), then it resolves to `__default__` (keeps the unchanged frontend working).

**Acceptance criteria:**
- `EventMetadata` gains nullable `WorkspaceId`; old events deserialize with `null`.
- `/w/{workspaceId}` route group; `ICurrentContext` exposes validated `WorkspaceId`; rootless routes default to `__default__`.
- `NoteAssignedToWorkspace` emitted on `CreateNote`; Note aggregate folds `_workspaceId`.
- NoteCard, NoteDetail, NoteTitleList, NoteSearchView (+ GSI), TagIndex, NoteActions carry `WorkspaceId` and filter by (user, workspace); `null→default`.
- BDD + Api.Integration + EventStore.Integration (search GSI) green.

### Slice 23-C — Scope folders + to-dos; enforce delete-if-empty

**User value:** Folders, the To-Do list, and tag filters are now per-workspace; a non-empty workspace cannot be deleted.

**Scenarios (GWT):**
- Given folders in workspace A, when I `GET /w/B/folders`, then none of A's folders appear.
- Given a note's action item in workspace A, when I `GET /w/A/todos`, then it appears; under `/w/B/todos` it does not.
- Given a standalone to-do added under `/w/A`, when listed under `/w/B/todos`, then it is absent (workspace from metadata).
- Given a workspace holding one active note, when I `DELETE` it, then `409` with a clear "not empty" error.
- Given a workspace whose notes are all deleted/moved away, when I `DELETE` it, then it is removed.

**Acceptance criteria:**
- FolderTree carries `WorkspaceId` (from metadata); filtered by (user, workspace); `null→default`.
- TodoList: action-item rows take the parent note's current workspace (via a `noteId→workspace` map the projection maintains); standalone-todo rows take metadata workspace; filtered per workspace.
- `DeleteWorkspace` pre-condition checks active-note count in the workspace; blocked → `409`.
- BDD + Api.Integration green.

### Slice 23-D — Frontend workspace routing + context

**User value:** The app is workspace-addressed; URLs carry the workspace; deep links keep working. Still one (default) workspace.

**Scenarios (GWT):**
- Given I open `/`, when the app loads, then I am redirected to `/w/__default__/`.
- Given I am at `/w/{ws}/`, when any data loads, then every API call targets `/w/{ws}/…`.
- Given I open a deep link `/w/{ws}/notes/{id}`, when authenticated, then the note loads in that workspace.
- Given query caches for workspace A, when the workspace in the URL changes, then caches are reset/keyed so no A data shows under B (**optimistic-UI AC**: switch reflects immediately, no stale cross-workspace flash).

**Acceptance criteria:**
- Routes gain the `/w/:wsId` prefix; `/` and unknown → default; Phase 21 deep-link recovery preserves `wsId`.
- `WorkspaceContext` derives the active workspace from route params; `useCurrentWorkspace()` hook.
- `api/client.ts` injects `/w/{wsId}` for scoped paths; `queryKeys.ts` includes `wsId`; cache reset/scoped on switch.
- Hand-rolled `cards`/`useNotes` also threaded with `wsId` (Refactor note re: Phase 20).
- Vitest/RTL + a Browser.E2E deep-link journey green.

### Slice 23-E — Workspace switcher + CRUD UI *(prototype first)*

**User value:** A user can see, switch, create, rename, and delete workspaces from the sidebar.

**Scenarios (GWT):**
- Given multiple workspaces, when I open the sidebar, then a switcher shows the active workspace and lists the others.
- Given the switcher, when I pick another workspace, then I navigate to `/w/{that}/` and its content loads.
- Given the switcher, when I create "Work", then it appears and I switch into it (**optimistic**).
- Given a non-default workspace, when I rename/delete it, then the list updates optimistically; a non-empty delete surfaces the `409` as an inline error.

**Acceptance criteria:**
- Prototype the switcher UX before implementation (novel interaction) per the `prototype` skill.
- Switcher + CRUD in the sidebar; default workspace shows no delete affordance.
- Optimistic create/rename/delete with rollback on error; non-empty-delete error surfaced.
- Vitest/RTL green; Stylist pass.

### Slice 23-F — Move a note to another workspace

**User value:** A note created in the wrong workspace can be moved to the right one.

**Scenarios (GWT):**
- Given a note in workspace A, when I move it to B, then `NoteAssignedToWorkspace { B }` is appended and it appears under `/w/B` and is gone from `/w/A` (**optimistic** removal from the current view).
- Given a filed note, when I move it to B, then `NoteUnfiled` is also appended (it lands in B's Unfiled).
- Given a note, when I move it to its current workspace, then no-op (no event).
- Given a move target that is not mine / does not exist, then `404`.
- Given the move, then its action-item to-do rows, tags, and search doc re-bucket to B.

**Acceptance criteria:**
- `MoveNoteToWorkspace` command + handler; emits `NoteAssignedToWorkspace` (+ `NoteUnfiled` if filed).
- All note-derived read models (NoteCard, NoteDetail, NoteTitleList, TagIndex, TodoList action rows, NoteSearchView) re-bucket on the move event.
- Move control on the note view and/or card menu lists the user's other workspaces.
- BDD + Api.Integration + Vitest/RTL green.

### Slice 23-G — Cleanup + backfill

**User value:** None directly — removes the migration scaffold and guarantees prod data is correctly bucketed.

**Acceptance criteria:**
- Remove the rootless fallback routes; all content endpoints are `/w/{wsId}`-only.
- `ProjectionRebuildHandler` verified to repopulate `WorkspaceList` and apply `null→default` across every projection.
- **Post-deploy backfill** (mandatory Scribe step for projection-adding slices): `POST /admin/projections/rebuild`; verify `WorkspaceList` count and that every projection's item counts match per workspace.
- Learnings doc.

---

## Observability

Silent failure modes to instrument (run `observability-brief` when Breaker finalises each slice):

| Risk | Symptom | What to make visible |
|---|---|---|
| Workspace validation too strict | User locked out of their own data (`404` on a valid workspace) | Metric/log on workspace-validation rejections with `userId`/`workspaceId`. |
| `null→default` mapping missed in a projection | Historical notes vanish in prod after deploy | Backfill verification (23-G) + per-workspace item-count check. |
| Move re-bucket partial | A moved note disappears from both workspaces | Log the move with source/target; alarm on rebuild faults (pairs with the existing rebuild-robustness tech-debt item). |
| Cache not reset on switch | Workspace A data flashes under B (**isolation leak**) | Covered by a Browser.E2E switch journey; no PII in logs (never log note content or query text). |

---

## Constraints

- **Notes only** are movable in v1; folder/to-do move is a future additive slice (`MoveFolderToWorkspace`/`MoveTodoToWorkspace` → `*AssignedToWorkspace`, same pattern).
- **No event-log migration** — historical data resolves to `__default__` at read time.
- **Calendar stays global**; only the note created from a meeting is workspace-scoped.
- Every projection-adding slice ships empty and **must** be backfilled post-deploy (23-B, 23-C).
