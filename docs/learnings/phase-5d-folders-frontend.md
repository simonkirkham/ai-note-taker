---
phase: 5-D
batch: 2
title: Folders Frontend Wire-Up
date: 2026-05-14
---

# Phase 5-D Batch 2 — Folders Frontend

## What was built

Wired the fully-complete `POST /folders` and `GET /folders` backend endpoints into the React frontend, replacing all localStorage folder state with real API calls. Added E2E journey tests for folder navigation.

## Key changes

### App.tsx
- Removed `notetaker-folders` and `notetaker-note-folder-map` localStorage state entirely.
- On mount, calls `getFolders()` and stores result in `folders` state.
- `handleCreateFolder` now calls `POST /folders` then refreshes tree from `GET /folders`.
- `handleRenameFolder` and `handleDeleteFolder` likewise refresh tree from API after mutation.
- Removed the client-side `addFolderToTree`, `renameFolderInTree`, `deleteFolderFromTree` helpers that were mutating local state optimistically.
- `noteFolderMap` removed — folder membership now comes from `card.folderId` on each `NoteCard` from the cards API (fully wired in 5-G).

### Sidebar.tsx
- Added `data-testid` attributes: `home-button`, `new-note-button`, `new-folder-button`, `unfiled-notes-button`, `new-folder-input`.
- Added `aria-label` to all icon/action buttons.

### FolderTree.tsx
- Added `data-testid="folder-item-{folderId}"` on each folder `<li>`.
- Added `data-testid="folder-name-{folderId}"` on the clickable name button.
- Added `data-testid="add-subfolder-button"` on the + subfolder button.
- Added `data-testid="subfolder-input"` on the inline subfolder input.
- Added `aria-label` on all action buttons (expand, preview, add subfolder, rename, delete).

### ListView.tsx
- Removed `noteFolderMap` prop; folder filtering now uses `card.folderId` directly.
- `TodoSection` is hidden whenever `currentFolderId` is set (any folder view, including Unfiled Notes).

### FolderPreviewPanel.tsx
- Removed `noteFolderMap` prop (note-to-folder membership now comes from the API in 5-G).

## Learnings

### localStorage as temporary scaffolding
The prototype used localStorage for folder state as quick scaffolding. Replacing it with real API calls is straightforward but requires awareness of where state was being derived: `noteFolderMap` fed both `ListView` filtering and `FolderPreviewPanel`. The `card.folderId` field on `NoteCard` already exists in the API response, so the filter logic simplification was clean.

### Folder tree refresh pattern
Rather than optimistic local mutations + fire-and-forget API calls, this implementation uses an async pattern: await the mutation, then `getFolders()` to get the canonical server state. This is slightly slower but avoids ID-mismatch bugs (client-generated UUIDs vs server-generated UUIDs) and keeps local state consistent with the server.

### E2E test design for folder UI
Folder interactions require careful test helpers:
- `CreateFolderAsync` waits for the `POST /folders` response so the folder is in the server before assertions.
- `CreateSubfolderAsync` uses `.First` to pick the first matching add-subfolder button, since multiple folders may have the same button testid.
- `AssertFolderHeadingAsync` uses `GetByRole(AriaRole.Heading)` rather than `GetByText` to verify the folder name appears as a heading, distinguishing it from sidebar entries.

### TodoSection visibility contract
The `TodoSection` is hidden in ALL folder views — this includes "Unfiled Notes". The condition in `ListView` is simply `!currentFolderId` (no special-casing needed). This is cleaner than the original `!currentFolderId` check which used the undefined/null distinction; making it a plain boolean coercion keeps it readable.
