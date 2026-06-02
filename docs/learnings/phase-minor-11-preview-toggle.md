# CHANGE-11 — Preview pull-out `»` becomes `«` when its panel is open

**Shipped:** PR #126, merge `e1798e9`, deployed 2026-06-02. Frontend-only.

## What changed
The folder / Unfiled "preview notes" pull-out button always showed `»`, even when its panel was open. Now `previewFolderId` is threaded from `App` → `Sidebar` → `FolderTree` → each node, so the currently-previewed row's button shows **`«`** (label *"Close … preview"*) and every other shows **`»`** (*"Preview …"*). `App`'s `onPreview` became a toggle — `setPreviewFolderId(prev => prev === folderId ? null : folderId)` — so clicking an open folder's button closes it; clicking a different folder switches. Files: `App.tsx`, `Sidebar.tsx`, `FolderTree.tsx`, plus `Sidebar.test.tsx` + `FolderNavigation.test.tsx`. No event/projection/API change.

## Technical notes
- Threading a single new required prop through three layers (`Sidebar`, `FolderTree` wrapper, recursive `FolderTreeNode`) is the bulk of the change. Making it **required** (not optional) is what guarantees no node is left rendering a stale `»` — an unthreaded site fails `tsc` rather than silently misbehaving.
- The toggle reducer covers all three transitions in one line: open-when-closed, close-on-re-click, and switch-without-closing (`prev !== folderId`).

## Process learnings
- **Match the test to how the component signals state.** The first toggle test asserted the preview panel *unmounts* on close (`queryByTestId(...).not.toBeInTheDocument()`) and failed — `FolderPreviewPanel` always renders its `data-testid` wrapper and toggles a `folder-preview-panel--open` class from `folderId` truthiness. Reading the component's render before writing the assertion would have avoided the failed run; asserting on the `--open` class via `waitFor` is the correct observation.
- **Apply a reviewer's trivial flagged tidy when you already own the lines.** Hawk noted the closed-state `title` ("Preview notes") disagreed with the `aria-label` ("Preview folder notes") on the folder button — a pre-existing mismatch, but cheap to align since the same two lines were being edited. Cost one small commit; left the diff clean.
- **Concurrent-session merge gate, applied correctly this time.** At merge time the other session's 10-K deploy was in progress; held the merge, waited for it to complete green, re-checked that nothing newer was running, then merged in the same step (guarded by an inline status check). This is the corrected discipline after the earlier CHANGE-9/10-I overlap. See [[merge-gate-main-deploy-only]].
