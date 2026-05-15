# Learnings: Phase 5-EFGHIJKL — Folder rename/delete/move/cascade + note filing

- **Pip started working on main instead of the worktree.** The CLAUDE.md guardrail "never commit slice work directly to main" was violated, requiring a stash → worktree → re-apply recovery. **Action:** No guardrail change needed — the rule exists. Surface as a reminder that the first tool call after `git worktree add` must be `cd <worktree>`, not any file edits in the main checkout — TODO (human awareness).

- **TypeScript type changed from optional to required (`folderId?: string` → `folderId: string | null`), breaking a test fixture.** `NoteCard.test.tsx` defined a `base` fixture without `folderId`, which was valid when optional but became a type error when made required. The local `tsc -p tsconfig.test.json --noEmit` check passed (because the worktree had the old compiled artefacts) but CI failed. **Action:** When tightening a type from optional to required, always grep for all typed usages of that interface before pushing — Done (fixed in the follow-up commit).

- **`UnfileNotesInFolderAsync` wrote `NoteUnfiled` events directly to the event store instead of delegating to `NoteCommandHandler`.** This left `LastModifiedAt` stale on the card projection and missed updating `NoteDetailStore` and `NoteTitleListStore`. Caught by Hawk. **Action:** Add to the refactor skill — "any cross-aggregate orchestrator that fires events on a note stream must delegate through `NoteCommandHandler.HandleAsync(UnfileNote)`, not bypass it" — Done (fixed by injecting `NoteCommandHandler` into `FolderCommandHandler`).

- **`RenameFolder` returned 400 for a non-existent folder (should be 404).** Generic `InvalidOperationException` was thrown for both "not found" and "invalid input" cases; the handler caught all `InvalidOperationException` as `BadRequest`. The existing `NoteNotFoundException` pattern was the correct model but was not applied to the new `Folder` aggregate. Caught by Hawk. **Action:** Add to the `aggregate-command` skill — "create a dedicated `XNotFoundException` for each aggregate; never throw generic `InvalidOperationException` for not-found semantics." Done — `FolderNotFoundException` created and handler updated.

- **`Note.HandleMoveToFolder` had no no-op guard for filing a note to the folder it's already in**, causing redundant `NoteFiledInFolder` events to accumulate on every re-file. Caught by Hawk. **Action:** Add to the refactor smell table — "`HandleMoveToFolder` missing idempotent guard: `if (cmd.FolderId == _folderId) return [];`" and add a `NoOpWhenAlreadyInSameFolder` spec. Done.

- **`CycleDetectedException` was defined inside `FolderCommandHandler.cs`** below the main class, making it hard to discover. **Action:** Extract exception types to their own files in `src/Api/`. Done — moved to `src/Api/CycleDetectedException.cs`.

- **Vitest segfault (exit code 139) in CI was a flaky runner crash**, not a code failure. TypeScript checks and tests that ran passed cleanly. **Action:** Re-run the failed job; if a Vitest run exits 139 with tests passing up to the crash, treat as infrastructure noise and rerun. Documented — TODO (runner-side, not actionable in code).

- **Hawk reviewed twice** (77 k + 62 k tokens combined) due to six findings in the first pass. The extra round cost ~62 k tokens. **Action:** Before opening a PR, cross-check the "component-test specific" and "architecture" smell tables from the refactor skill against any new cross-aggregate handler. The `UnfileNotesInFolderAsync` bypass and the 404/400 distinction are both checkable pre-PR — TODO.

## Applied status

| Learning | Status |
|---|---|
| 1. Pip started on main | Documented — guardrail already exists; human awareness item |
| 2. Optional→required type broke test fixture | Applied — fix commit `b656849` adds `folderId: null` to test base fixture |
| 3. UnfileNotesInFolderAsync bypassed NoteCommandHandler | Applied — `NoteCommandHandler` injected into `FolderCommandHandler`; method simplified |
| 4. RenameFolder returned 400 for 404 case | Applied — `FolderNotFoundException` created; handler updated; integration test corrected |
| 5. HandleMoveToFolder missing no-op guard | Applied — guard added to `Note.cs`; `NoOpWhenAlreadyInSameFolder` spec added |
| 6. CycleDetectedException defined inside handler file | Applied — extracted to `src/Api/CycleDetectedException.cs` |
| 7. Vitest segfault flaky CI | Documented — rerun strategy confirmed effective |
| 8. Two Hawk rounds due to pre-PR misses | Documented — pre-PR checklist suggestion for cross-aggregate handlers |
