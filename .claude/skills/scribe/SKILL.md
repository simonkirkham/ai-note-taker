---
name: scribe
description: Post-deploy documentation agent. Runs after a slice lands on main. Orchestrates token-log, process-improvements, and doc updates. Triggers include "deploy succeeded", "slice is done", "run Scribe".
---

# Scribe

Run after the main pipeline passes following a slice merge. No human approval needed.

## Sequence

1. **[`token-log`](./../token-log/SKILL.md)** — collect agent token counts, append to `docs/token-log.md`, identify spikes.
2. **[`human-input-log`](./../human-input-log/SKILL.md)** (capture mode) — drain the live permission rows for this slice's branch, reconstruct the gate/clarification/decision/unblock rows from the session, append to `docs/human-input-log.md`. Hand every `Avoidable? = Yes` row to step 3.
3. **[`process-improvements`](./../process-improvements/SKILL.md)** — permission audit + learnings doc + execute Done actions. Pass any spike observations from step 1 **and the avoidable human-input rows from step 2** as inputs.
4. **Update progress tracking:**
   - `docs/phases/phase-N.md` — mark every completed acceptance criterion `[x]`, set the slice's per-slice `**Status:**` line to `Done`, **and update that slice's `Status` cell in the `## Summary` table at the top of the doc** (the two must always agree). For a standing phase (`phase-bugs.md`, `phase-minor-changes.md`), mark the fixed item Done in both the per-item `**Status:**` line and the `## Summary` table row.
   - `docs/roadmap.md` — mark phase as `_(Done)_` if all slices are complete; update `_(In Progress)_` if partially done; keep the standing-tracks summaries (Bugs / Minor Changes / Future Features / Technical Improvements) in sync.
   - If the slice delivered something listed in `docs/future-features.md` or `docs/technical-improvements.md`, remove that entry from the register.
5. **Backfill a new projection** (only if the slice added one). After the deploy is green, invoke `POST /admin/projections/rebuild` (authenticated) and verify the new table's item count matches the live count. A deploy creates the table but **never populates it** — skip this and the feature returns nothing in prod though every test passed (Phase 22 search returned no results until the `NoteSearchView` backfill ran). Skip when the slice added no projection. See the CLAUDE.md backfill guardrail.
6. **Update developer docs** (only if the slice changed them):
   - `README.md` — new env vars, tables, scripts, ports, or prerequisites; verify names against `launchSettings.json` / CDK stack before editing
   - Any other `docs/` file describing something the slice changed (event schemas, view schemas, ADRs, architecture)
7. **Condense docs — phase-boundary pass + opportunistic prune:**
   - **Opportunistic (every slice):** prune only what *this slice* made stale — a closed bug's verbose repro, a superseded "current approach" note, a resolved TODO in a doc the slice touched. Do not edit docs unrelated to the slice.
   - **Full condense pass (only when the slice completes a phase):** consolidate the whole phase's docs. Collapse Done slices in the `## Summary` table to one row each, fold per-slice detail into a one-line outcome (link to the learnings doc for the *why*), move long-dead content out of the live doc, and confirm the roadmap entry is a single paragraph that links to detail rather than restating it. Apply the `## Writing style` rules and the index-first convention: one fact in one place, link don't inline.
   - Net effect must be **fewer tokens to read for the same information** — if a condense edit grows a doc, revert it.
8. **Commit** — single commit with message `docs: scribe notes for slice <id>`, covering all files written/edited in the steps above (the step-5 backfill is an API call, not a file). First `git status` the main checkout: if it carries changes outside the files Scribe itself wrote/edited (e.g. a human's in-flight WIP), stage only Scribe's own files by path — never `git add -A`/`.` — and leave the foreign changes untouched. If the primary checkout is dirty **or** its local `main` has diverged from `origin/main` (a `git push` would be non-fast-forward), do not commit in it at all: run Scribe from a fresh worktree off `origin/main` (`git worktree add <path> -b docs/scribe-<id> origin/main`), commit there, and push directly with `git push origin HEAD:main`. This keeps entirely clear of the human's working copy.
9. **Hand off** — first verify the tree is clean of Scribe's own work: `git status` must show **no uncommitted doc Scribe wrote or edited** (a human's pre-existing WIP may remain, by name). Then post the learnings file path, count of Done actions applied, any TODO items for the human, and — if a full condense pass ran — the docs condensed.

## What Scribe does NOT do

- Change feature code, tests, the event model, or CDK stacks
- Update README from memory — verify against source files first
