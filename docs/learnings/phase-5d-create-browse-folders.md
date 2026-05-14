---
name: phase-5d-create-browse-folders
type: project
date: 2026-05-14
---

# Phase 5-D: Create and Browse Folders

## What was built

Batch 1 of Slice 5-D adds the folder aggregate and a read tree projection. Users can now create root folders and subfolders via `POST /folders` and retrieve the full nested tree via `GET /folders`. No frontend in this batch.

New files:
- `src/Domain/Folders/` — `Folder` aggregate with `CreateFolder` command and `FolderCreated` event; `FolderId` value type
- `src/EventStore/Projections/FolderTreeView.cs`, `IFolderTreeStore.cs`, `FolderTreeProjection.cs`, `DynamoDbFolderTreeStore.cs`
- `src/Api/FolderCommandHandler.cs`, `Handlers/FolderHandlers.cs`, `Endpoints/FolderEndpoints.cs`, `Contracts/CreateFolderRequest.cs`
- CDK table `notetaker-proj-foldertree` with `PROJ_FOLDERTREE_TABLE_NAME` env var
- BDD spec: 4 scenarios covering root folder, subfolder, empty name, whitespace name
- API integration tests: 5 scenarios (split across two classes for isolation)
- CDK assertions: `FolderTreeTable_Exists` and `Lambda_HasFolderTreeTableEnvVar`

## Key learnings

**Test isolation with IClassFixture.** xUnit creates one `ApiFactory` instance per test class, not per test. The "returns empty" scenario must live in its own class (`FolderEmptyTests`) to get a fresh in-memory store, otherwise tests that create folders in the same class pollute its state. The existing `NoteCardsIntegrationTests.GetNoteCards_ReturnsEmptyWhenNoNotes` only passes because it happens to run first — a fragile assumption. The fix used here (separate class) is the correct pattern.

**Recursive tree building without a dedicated tree type.** The `GET /folders` handler builds a nested JSON tree using a recursive helper that filters by `ParentFolderId`. Anonymous objects work cleanly for this because the response shape is leaf-driven, not a typed graph. If more operations on the tree were needed, a proper `FolderTreeNode` record would be warranted.

**`_exists` field on a single-command aggregate.** The `Folder` aggregate tracks `_exists` even though no current business rule uses it. This is intentional — it mirrors the `Note` aggregate pattern and leaves room for future commands (e.g. `RenameFolder`, `DeleteFolder`) to guard against operating on non-existent or deleted folders without a structural change.

**Builder.cs signature growth.** Each new projection table adds a positional parameter to `Builder.BuildApp`. With seven tables now, this is approaching the limit of readability. An options record would be a worthwhile refactor if another two or three tables are added.
