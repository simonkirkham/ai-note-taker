---
name: run-pipeline
description: Drive a slice (or a whole phase) through the project pipeline end to end — Breaker → Pip → Refactor → Stylist → PR → Hawk → merge → Scribe — pausing only at the defined human gates and parallelising across independent slices. Triggers include "run the pipeline", "execute slice 16-A", "take this slice to merge", "drive phase N".
---

# Run Pipeline

Orchestrates the slice/phase delivery workflow. It **sequences** the roles and skills; it does not redefine them.

> **CLAUDE.md is the single source of truth.** The `## Workflow`, `## Guardrails`, `## Worktrees`, `## Handing back to the human`, and `## Human gates` sections in CLAUDE.md are canonical. This skill never overrides them — if anything here ever conflicts with CLAUDE.md, CLAUDE.md wins. Re-read those sections before each run; they change.

**Every hand-back to the human — at any point in the run, not just the end — is the block in CLAUDE.md `## Handing back to the human`, and nothing follows it.** A pause for a blocker, a merge gate you cannot clear, a manual `cdk deploy`, or the finish all end the same way. Anything you would ask for must survive being written as a `DECISIONS FOR YOU` or `ACTIONS FOR YOU` entry with a convincing `Why it needs you:` line; if it does not, decide it, note the assumption under `YOU SHOULD KNOW`, and keep driving.

**Ask a peer before you stop for the human — rule 5 of `### When NOT to hand back`.** A pipeline run generates exactly the questions peers answer best: is this red gate mine, is someone already on this bug id, is that branch safe to touch, has anyone seen this failure. `ListAgents` then `SendMessage`, and keep driving while you wait. The human is the last resort — escalate only when no peer can answer and the question is genuinely theirs.

**Read `### When NOT to hand back` in the same CLAUDE.md section before every run — it binds this skill hardest.** A pipeline run is exactly where the three failures live: asking whether to continue work the human already approved; ending a turn on "I'll check the gates and merge" instead of checking the gates and merging; and claiming to be waiting on CI or Hawk with nothing actually polling. Before ending any turn mid-run, confirm the background job you are waiting on is genuinely started.

## Autonomy: written-up work runs end to end

**Authorisation is per approach, not per step** (`CLAUDE.md` → `## Guardrails`, `## Human gates`). Work is **written up** — and therefore already authorised — when it has a slice in a phase doc, or a row in `phase-bugs.md` / `phase-minor-changes.md` / `phase-model-prompt-improvements.md` / `technical-improvements.md`. The write-up **is** the spec, however short the row. Once the human has asked for that backlog driven down, starting any row in it is agreed work. So written-up work runs **end to end without pausing** — Breaker → Pip → Refactor → Stylist → PR → Hawk → merge → Scribe, all autonomous. Never re-ask per item.

A thin row still authorises the work; it does not excuse skipping Breaker. Where a row names a symptom but no scenarios, Breaker writes the GWT from the row and proceeds — that is Breaker's job, not a reason to stop.

For written-up work, stop only for:

- **Manual `cdk deploy`** — when deploying by hand (the merge-triggered deploy needs no gate).
- **A genuine blocker** — an ambiguity no peer can resolve, a merge/CI gate you can't make green, or a destructive/irreversible action you would recommend.

### When the work is NOT yet written up

If the target appears in no phase doc and no tracking table, the upstream human gates still apply. Pause and wait for explicit go-ahead at:

1. **Scout brief** — before drafting/altering a phase doc.
2. **Breaker spec writing** — before writing specs for the un-written-up slice.
3. **Pip implementation start** — before implementing it.

Once the human approves the drafted phase doc, the approach is agreed and everything downstream runs autonomously — no further prompting. Past that point the human is the **last resort**: peers answer ownership, claims, red gates and unfamiliar failures (`CLAUDE.md` → `### When NOT to hand back`, rule 5).

Everything between/after gates — refactor, stylist, PR, Hawk fixes, gate checks, merge, worktree cleanup, deploy monitoring, Scribe — always runs without asking. If you catch yourself asking for approval and the work is already written up, don't: proceed.

## Per-slice sequence

For each slice, follow CLAUDE.md `## Workflow` steps 1–15. Steps 1–3 are gates **only when the work is not yet written up** (see Autonomy above); for a written-up slice or tracking-doc row they run straight through. In brief:

0. **Sync first — `git fetch` and read `origin/main`'s phase doc before reading the plan or starting any slice.** The local working tree is **not** "current" when another session may be driving the same phase: it can hold a stale phase doc whose stubs were already filled in (or whose slice was already merged) upstream. Building against the stale copy means re-doing the slice (20-E was built twice — PR #198 thrown away — for exactly this). Check the `## Summary` table's `Status` column on `origin/main`, not local, before deciding what to scout/build.
1. *(gate if not yet written up)* Plan; Scout drafts the phase doc with the `## Summary` table. Skip when the slice or row already exists. **Slice thin and vertical** (CLAUDE.md `## Conventions`): each slice is an independently-shippable vertical through the layers it needs, delivering/proving one user-meaningful capability — never a horizontal layer. For a big or uncertain capability, the first slice is the **smallest one that proves the whole flow end-to-end on one real call**; later slices scale the proven pattern. **Never spec a big-bang cross-cutting cutover** (consistency model, storage/transport swap, framework migration) — prove it on one vertical slice, then strangle the rest flow-by-flow (CLAUDE.md guardrail; the Phase 27-C revert is why). If a slice can't ship alone, re-cut it.
2. *(gate if not yet written up)* **Breaker** creates the worktree + branch (`slice/<phase>-<id>-<desc>`), `dotnet restore` + `npm --prefix web install`, `/rename` the session, writes the failing BDD spec. **Layer-split any large slice** (≥4 of: new aggregate, new projection, new CDK table, new component, E2E journey): Breaker writes domain/API tests first → Pip implements → Breaker writes E2E/frontend tests → Pip implements. Two smaller Pip passes keep each under ~65k and avoid the mid-slice context compaction that every >100k single Pip session has hit. (This "layer-split" is only about sequencing **implementation passes within one vertical slice** for context size — it is NOT slicing by layer; the slice itself stays a thin vertical per step 1.)
3. *(gate if not yet written up)* **Pip** implements until specs are green. Optimistic-UI acceptance criterion is mandatory for any frontend change.
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

> **Build the backend locally the way CI does — `dotnet build ai-note-taker.sln -p:TreatWarningsAsErrors=true`.** CI's backend job uses that flag; a plain `dotnet build` only *warns* on e.g. CS8631 (`string?` in `Assert.Equal(span, array)` — null-forgive with `!`), so it greens locally then red-fails CI (recurred 43-A → 43-C, a wasted round-trip each time). For frontend, `npm run lint` locally is unreliable under WSL — trust the CI `frontend` check as the final word but still run it.
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
- **Background monitors.** CI checks and deploy polling run as scheduled background loops, not blocking foreground waits. **Do NOT use the `Monitor` tool for this — it needs a per-launch approval and reads as "forcing permissions" (43-A interruption).** Use the read-only helper scripts as **single** Bash calls (`scripts/deploy-status.sh`, `scripts/merge-gate.sh <pr>`, `scripts/ci-logs.sh`) or a `run_in_background` Bash with an `until` loop (one completion notification) — both covered by `Bash(*)`, no prompt.
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
