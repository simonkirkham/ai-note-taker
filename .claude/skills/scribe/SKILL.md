---
name: scribe
description: Post-deploy documentation agent. Runs after a slice lands on main. Orchestrates token-log, process-improvements, and doc updates. Triggers include "deploy succeeded", "slice is done", "run Scribe".
---

# Scribe

Run after the main pipeline passes following a slice merge. No human approval needed.

## Sequence

1. **[`token-log`](./../token-log/SKILL.md)** — collect agent token counts, append to `docs/token-log.md`, identify spikes.
2. **[`process-improvements`](./../process-improvements/SKILL.md)** — permission audit + learnings doc + execute Done actions. Pass any spike observations from step 1 as inputs.
3. **Update progress tracking:**
   - `docs/phases/phase-N.md` — mark every completed acceptance criterion `[x]`, set the slice's per-slice `**Status:**` line to `Done`, **and update that slice's `Status` cell in the `## Summary` table at the top of the doc** (the two must always agree). For a standing phase (`phase-bugs.md`, `phase-minor-changes.md`), mark the fixed item Done in both the per-item `**Status:**` line and the `## Summary` table row.
   - `docs/roadmap.md` — mark phase as `_(Done)_` if all slices are complete; update `_(In Progress)_` if partially done; keep the standing-tracks summaries (Bugs / Minor Changes / Future Features / Technical Improvements) in sync.
   - If the slice delivered something listed in `docs/future-features.md` or `docs/technical-improvements.md`, remove that entry from the register.
4. **Update developer docs** (only if the slice changed them):
   - `README.md` — new env vars, tables, scripts, ports, or prerequisites; verify names against `launchSettings.json` / CDK stack before editing
   - Any other `docs/` file describing something the slice changed (event schemas, view schemas, ADRs, architecture)
5. **Commit** — single commit with message `docs: scribe notes for slice <id>`, covering all files from steps 1–4. First `git status` the main checkout: if it carries changes outside the files Scribe itself wrote/edited (e.g. a human's in-flight WIP), stage only Scribe's own files by path — never `git add -A`/`.` — and leave the foreign changes untouched. If the primary checkout is dirty **or** its local `main` has diverged from `origin/main` (a `git push` would be non-fast-forward), do not commit in it at all: run Scribe from a fresh worktree off `origin/main` (`git worktree add <path> -b docs/scribe-<id> origin/main`), commit there, and push directly with `git push origin HEAD:main`. This keeps entirely clear of the human's working copy.
6. **Hand off** — post the learnings file path, count of Done actions applied, and any TODO items for the human.

## What Scribe does NOT do

- Change feature code, tests, the event model, or CDK stacks
- Update README from memory — verify against source files first
