# Learnings: BUG-2 — favicon.ico 404 on every page load

- The slice was interrupted by a VS Code crash with the fix fully written but uncommitted. Recovery was clean: the work survived intact in the per-slice worktree (`slice-bug-2-favicon`) as staged changes, so `git status` + the staged diff + `git reflog` were enough to confirm exactly where it stopped before resuming the pipeline. **Action:** none executable — this confirms the value of worktree-per-slice isolation: an editor/host crash doesn't lose in-flight slice work — Documented.
- At resume time the shared main checkout carried a large unrelated uncommitted docs reorganization (18 phase docs reformatted to Summary tables). Scribe's commit step would have swept that WIP into a `docs: scribe` commit. Surfaced it to the human and committed only Scribe's own files. **Action:** add a Scribe rule to inspect the main checkout's working tree before committing and stage only Scribe's own files when foreign changes are present — Done (`scribe/SKILL.md`). See memory `feedback_main_staged_index`.
- BUG-1's outstanding TODO to gitignore `web/tsconfig.app.tsbuildinfo` is still open (the file remains tracked and un-ignored), but it did not bite this slice — the build run by the pre-commit hook did not dirty it, likely because the hook was recently scoped to staged changes. **Action:** none here — the gitignore change remains a separate repo-wide commit the human can pick up — TODO (carried from BUG-1).

## Applied status

| Learning | Status |
|---|---|
| 1. Worktree isolation preserved work across the editor crash | Documented — recovery via worktree staged diff + reflog |
| 2. Scribe should not sweep foreign main-checkout WIP into its commit | Applied — rule added to `.claude/skills/scribe/SKILL.md` |
| 3. Gitignore `web/tsconfig.app.tsbuildinfo` | TODO — carried from BUG-1; needs its own `git rm --cached` commit |
