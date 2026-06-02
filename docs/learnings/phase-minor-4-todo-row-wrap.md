# CHANGE-4 — To-do rows wrap cleanly with long text and a note title

**Shipped:** PR #104, merge `0441454`, deployed 2026-06-02. Frontend CSS + markup-only layout fix.

## What changed
Long note-derived to-dos broke the To-Do row: `.todo-note-title`'s `white-space: nowrap` reserved a wide fixed strip, squeezing `.todo-description` to one-word-per-line and pushing the Delete/Reopen buttons off the row. The fix wraps the description and note title in a new `.todo-item-content` flex column (`flex: 1; min-width: 0; flex-direction: column`) in **both** the open-items and Done `<li>`s, drops `white-space: nowrap` from the note title and `flex: 1` from the description, and adds `overflow-wrap: anywhere` to both. `.todo-item` switched to `align-items: flex-start` so the checkbox sits against the first line of a tall row.

Files: `web/src/components/TodoSection.tsx`, `web/src/App.css`, `web/src/__tests__/TodoSection.test.tsx`. Visual only — no `TodoItem`, event, projection, API, or complete/reopen/delete change.

## Technical notes
- `min-width: 0` on the flex content column is load-bearing: a flex item defaults to `min-width: auto`, which refuses to shrink below its content width, so without it the long text would still force overflow rather than wrap. This is the same trick used elsewhere in the app for truncating/wrapping flex children.
- The checkbox and the action buttons already carried `flex-shrink: 0`, so once the description stopped fighting the title for horizontal room the buttons stayed pinned with no further change.
- jsdom can't assert visual wrapping, so the added test guards reachability instead: a long note-derived item still exposes its description, note title, and the Delete control (queried by accessible name `Delete "<description>"`). Visual confirmation rests on the approved prototype (`prototype/todo-row-wrap`).

## Process learnings

1. **Crash-recovery on an uncommitted slice was clean because the worktree isolates WIP.** VS Code crashed with the full implementation staged-but-uncommitted in the slice worktree. Because slice work lives in its own worktree (not the shared main checkout), the WIP survived intact and was trivially recoverable: `git -C <worktree> status`/`diff main` showed exactly the in-flight change, it was already complete and matched the approved layout, so the only remaining work was verify → commit → PR → Hawk → merge. Worktree isolation paid off precisely as intended.

2. **Verify before assuming a recovered WIP is incomplete.** The temptation after a crash is to re-derive the change. Instead, diffing the worktree against `main` and re-running the targeted test + tsc + lint confirmed it was finished and green — cheaper than reconstructing it.

3. **A prototype-approved, spec-locked layout makes for a frictionless slice.** Hawk approved first pass with zero critical/important findings because the implementation was a line-for-line match of the "Approved layout" block already written into the phase doc by the prototype exit procedure. Locking the exact CSS into the phase doc before implementation removed all ambiguity.
