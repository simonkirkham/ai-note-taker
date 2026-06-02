# Learnings: BUG-4 + BUG-5 — exception→status mapping

- BUG-4 (ConcurrencyException→500) and BUG-5 (write to a deleted note→500) shared a single fix mechanism: a cross-cutting exception→status map in the global handler. Combining them into one slice avoided two PRs both editing `LoggingConfig.cs` and matched the natural unit of work. **Action:** when two tracked bugs resolve to one cross-cutting fix point, fix them in one slice and mark both Done — Done (this slice; both marked Done in `phase-bugs.md`).
- Moving the handler's existence check from `history.Count == 0` to `!note.Exists` (`_exists && !_deleted`) is strictly more correct: it distinguishes "never created" from "created then deleted", which a stream-length check cannot. The aggregate's own guards (`!_exists || _deleted`) and the handler pre-check now share one predicate, so they cannot drift. **Action:** none — Documented.
- Hawk flagged a scope-adjacent behaviour change: tag/untag/link on a *deleted* note now returns **404** instead of the previous **409** (it used to surface the domain `InvalidOperationException`, which those endpoints mapped to 409). 404 is more correct for a gone resource and no test asserted the old 409, so this was accepted as an intentional improvement, not a regression. **Action:** recorded here as intentional; no code change — Documented.
- Reproducing BUG-5 in-process required simulating the eventual-consistency window (stream deleted, projection still present) because the in-memory stores are synchronous and would otherwise 404 at the projection pre-check. Capturing the live `NoteDetailView`, deleting, then re-upserting it recreates the window deterministically without hand-building a view. **Action:** none — Documented (pattern reusable for other stale-projection repros).
- Scribe ran from a **separate worktree off `origin/main`**, not the primary checkout, because the primary checkout held the human's uncommitted docs WIP and its local `main` had diverged from origin. **Action:** extend the Scribe rule — when the primary checkout is dirty or its `main` has diverged from `origin/main`, run Scribe from a clean worktree off `origin/main` and push directly, rather than committing in the dirty checkout — Done (`scribe/SKILL.md`). See `feedback_main_staged_index`.

## Applied status

| Learning | Status |
|---|---|
| 1. Combine bugs that share one cross-cutting fix into one slice | Applied — BUG-4+5 shipped as one slice (PR #107) |
| 2. `!note.Exists` predicate shared by guard and handler | Documented — `Note.Exists`, `NoteCommandHandler.ExecuteAsync` |
| 3. tag/untag/link on deleted note → 404 (was 409), intentional | Documented — no code change |
| 4. Stale-projection repro via capture→delete→re-upsert | Documented — `ExceptionMappingTests` |
| 5. Run Scribe from a clean worktree when the checkout is dirty/divergent | Applied — rule added to `.claude/skills/scribe/SKILL.md` |
