# CHANGE-1 — Single-spaced note lines

**Shipped:** PR #98, deployed 2026-06-02. One-line scoped CSS change.

## What changed
`.content-input p { margin: 0 }` (plus small top/bottom margins on `.content-input h1/h2/h3`) in `web/src/App.css`. Collapses the inter-paragraph gap so the note editor reads single-spaced. Markdown serialisation is unaffected — paragraphs remain distinct `<p>` blocks; only the on-screen vertical gap changes.

## Technical notes
- `.content-input` is the ProseMirror contenteditable (class set once in `NoteEditor.tsx`), so the rule is naturally scoped and cannot leak to other screens. `NoteView` renders body content through the same editor, so there is no second rendering surface.
- The rule also tightens paragraphs nested inside list items (StarterKit wraps `<li>` content in `<p>`) — desirable, and `ul/ol` margins + markers keep lists distinct.
- No behavioural test is feasible for a pure margin change in jsdom; coverage is the unchanged existing component tests (184 passing) plus visual confirmation.

## Process learnings (apply to the whole CHANGE-1/2/3 batch)

These bit us during this batch and are worth remembering:

1. **The `.githooks/pre-commit` hook referenced pre-rename test project paths** (`tests/Specs`, `tests/ApiIntegration`, `tests/InfraAssertions`) and failed immediately when activated per CLAUDE.md. It had been dormant because the default `core.hooksPath` (`.git/hooks`) has no pre-commit, so commits were effectively ungated. Fixed during the batch (commit `f1cf537`). **`core.hooksPath` is shared repo-wide via `.git/config`** — setting it from one worktree changes it for the main checkout and *every* other worktree. Don't toggle it casually while other worktrees are in flight.

2. **The shared `main` checkout is a hazard for direct commits.** It frequently carries the user's pre-staged work and a constant CRLF↔LF line-ending churn on WSL (every file shows as fully modified under `git diff`, but `--ignore-all-space` is clean). `git commit <path>` (path-scoped) commits only the named file and leaves the rest of the index untouched — use it, never a bare `git commit`/`git add -A` on the shared checkout. Better: for doc/backlog edits, make them in a **throwaway detached worktree off `origin/main`** and push (`git push origin HEAD:main`), avoiding the messy checkout entirely.

3. **`gh pr merge --squash --delete-branch` fails from inside the slice worktree** ("'main' is already used by worktree") because it tries to switch the local branch off the merged branch. Run `gh pr merge --squash` from the **main checkout** (already on `main`) and skip `--delete-branch`; delete the remote branch with `git push origin --delete <branch>` and remove the worktree (`git worktree remove --force …`, then `git branch -D`) separately. Note the first failed attempt may still have merged remotely — check `gh pr view <n> --json state` before retrying.

4. **Concurrent user activity on `main`** means base branches drift fast. Branch slices off freshly-fetched `origin/main`, and fetch again right before any push to `main`.
