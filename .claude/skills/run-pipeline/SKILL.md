---
name: run-pipeline
description: Drive a slice (or a whole phase) through the project pipeline end to end — Breaker → Pip → Refactor → Stylist → PR → Hawk → merge → Scribe — pausing only at the defined human gates and parallelising across independent slices. Triggers include "run the pipeline", "execute slice 16-A", "take this slice to merge", "drive phase N".
---

# Run Pipeline

Orchestrates the slice/phase delivery workflow. It **sequences** the roles and skills; it does not redefine them.

> **CLAUDE.md is the single source of truth.** The `## Workflow`, `## Guardrails`, `## Worktrees`, and `## Human gates` sections in CLAUDE.md are canonical. This skill never overrides them — if anything here ever conflicts with CLAUDE.md, CLAUDE.md wins. Re-read those sections before each run; they change.

## Autonomy: a specced slice runs end to end

A slice is **specced** when its phase doc already holds that slice's **scenarios and acceptance criteria** — whether a numbered `phase-N.md` or a standing doc (`phase-minor-changes.md`, `phase-bugs.md`, `phase-model-prompt-improvements.md`). The human's approval of that phase doc **is** the authorization for the slice's spec and implementation. So a specced slice runs **end to end without pausing** — Breaker → Pip → Refactor → Stylist → PR → Hawk → merge → Scribe, all autonomous.

For a specced slice, stop only for:

- **Manual `cdk deploy`** — when deploying by hand (the merge-triggered deploy needs no gate).
- **A genuine blocker** — an ambiguity the doc doesn't resolve, a merge/CI gate you can't make green, or a destructive/irreversible action.

### When the slice is NOT yet specced

If the target has no phase doc — or only a title row in a `## Summary` table with no scenarios/acceptance criteria — the upstream human gates still apply. Pause and wait for explicit go-ahead at:

1. **Scout brief** — before drafting/altering a phase doc.
2. **Breaker spec writing** — before writing specs for the unspecced slice.
3. **Pip implementation start** — before implementing the unspecced slice.

Once the human approves the drafted phase doc, the slice is now specced and continues autonomously under the rule above — no further prompting.

Everything between/after gates — refactor, stylist, PR, Hawk fixes, gate checks, merge, worktree cleanup, deploy monitoring, Scribe — always runs without asking. If you catch yourself asking for approval and the slice is specced, don't: proceed.

## Per-slice sequence

For each slice, follow CLAUDE.md `## Workflow` steps 1–15. Steps 1–3 are gates **only when the slice is unspecced** (see Autonomy above); for a specced slice they run straight through. In brief:

0. **Sync first — `git fetch` and read `origin/main`'s phase doc before reading the plan or starting any slice.** The local working tree is **not** "current" when another session may be driving the same phase: it can hold a stale phase doc whose stubs were already filled in (or whose slice was already merged) upstream. Building against the stale copy means re-doing the slice (20-E was built twice — PR #198 thrown away — for exactly this). Check the `## Summary` table's `Status` column on `origin/main`, not local, before deciding what to scout/build.
1. *(gate if unspecced)* Plan; Scout drafts the phase doc with the `## Summary` table. Skip when the slice is already specced.
2. *(gate if unspecced)* **Breaker** creates the worktree + branch (`slice/<phase>-<id>-<desc>`), `dotnet restore` + `npm --prefix web install`, `/rename` the session, writes the failing BDD spec. **Layer-split any large slice** (≥4 of: new aggregate, new projection, new CDK table, new component, E2E journey): Breaker writes domain/API tests first → Pip implements → Breaker writes E2E/frontend tests → Pip implements. Two smaller Pip passes keep each under ~65k and avoid the mid-slice context compaction that every >100k single Pip session has hit.
3. *(gate if unspecced)* **Pip** implements until specs are green. Optimistic-UI acceptance criterion is mandatory for any frontend change.
4. **Refactor** skill over all changed files; re-run specs.
5. **Stylist** (`ui-ux-pro-max`) for user-facing slices; re-run tests.
6. Open the PR (`gh pr create --body-file .pr-body.md`). Keep the body terse — three bullet sections, no narrative paragraphs:

   ```markdown
   ## What
   - <one bullet per change>
   ## Why
   - <slice/issue ref + the reason, one line>
   ## Tests
   - <what was run / added, one line each>
   ```

   Immediately schedule a CI monitor (`gh pr checks <n>` every 60s).
7. **Hawk** — spawn `agent-skills:code-reviewer` on the PR *the moment it opens*, in parallel with CI. Do not wait for CI.
8. Hawk requests changes → fix every finding, then re-run `tsc --noEmit` + `npm run lint` **after this fix commit too** (not only after the first implementation pass — post-merge lint/type breaks have repeatedly come from an unchecked later fix commit), push, re-run Hawk. Hawk approves → check both merge gates, then merge.
9. Merge → remove the worktree, monitor the main deploy.
10. Deploy green → **Scribe** (runs the whole post-deploy sequence unasked). Deploy red → read `gh run view <id> --log-failed`, fix, push.

## Merge gates (hard, non-negotiable)

Before `gh pr merge --squash --delete-branch`, confirm **both**:

- **PR CI all green** — `gh pr checks <n>`: every check `pass`, none pending/failing. `--auto` does **not** hold the merge here; verify yourself.
- **Main deploy clear** — `gh run list --branch main --workflow deploy.yml --limit 1 --json number,status,conclusion`: `status` is `completed` **and** `conclusion` is `success`. If `in_progress`/`queued`, **wait it out** — never merge during a running deploy. Never use `--status completed` (it hides an in-progress run).

If either gate is not met, stop and wait/investigate.

## Where to parallelise (and where not to)

**Do parallelise:**
- **Independent slices.** Read the phase doc's `## Summary` table `Depends on` column. Slices with `—` (or whose deps are already merged) run concurrently, each in **its own worktree** (CLAUDE.md `## Worktrees`). Launch them in one batch; batch the human gate confirmations per stage.
- **Hawk ∥ CI.** Hawk starts at PR-open, alongside CI — never serialised behind it.
- **Background monitors.** CI checks and deploy polling run as scheduled background loops, not blocking foreground waits.
- **Independent read/research** within a slice (e.g. fanning out exploration) via subagents.

**Do NOT parallelise:**
- A slice and any slice that lists it under `Depends on` — finish and merge the dependency first.
- Refactor and Stylist within a slice — they mutate the same files; run sequentially.
- **Slices that touch the same file — even if their `Depends on` is `—`.** Two slices both appending to `App.css` or editing `NoteTakerStack.cs` is the parallel anti-pattern: no clean-merge benefit, double conflict resolution, and a full-suite pre-commit rerun on each re-merge. Sequence them instead (branch the second after the first merges) — wall-clock cost, not token cost. Evidence: the 3-slice shared-`App.css` parallel batch cost ~536k; the equivalent sequential pair cost ~209k.
- Merges of dependent slices out of order, or any merge while main's deploy is running.

> **One driver per slice.** Never both background a slice agent *and* take it over — a still-alive sub-agent colliding with the orchestrator on a shared worktree forces a reset + redundant re-merge. If you take over, treat the backgrounded agent as dead.

Cap concurrency to what you can review honestly — a stuck parallel slice must not stall the others, but never trade the merge gates for throughput.

## What this skill does NOT do

- Skip or reorder human gates, or merge with a gate unmet.
- Commit slice work to `main` directly, or merge a `prototype/`/`slice/` branch incorrectly (see CLAUDE.md guardrails).
- Replace the role skills — it calls `refactor`, `ui-ux-pro-max`, `scribe`, `code-reviewer`, etc.; it does not reimplement them.
