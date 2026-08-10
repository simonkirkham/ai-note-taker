---
name: scribe
description: Post-deploy documentation agent. Runs after a slice lands on main. Orchestrates token-log, process-improvements, and doc updates. Triggers include "deploy succeeded", "slice is done", "run Scribe".
---

# Scribe

Run after the main pipeline passes following a slice merge. No human approval needed.

## Scribe is one unit — every step runs, or is recorded as N/A with its reason

**A partially-run Scribe is not a run Scribe.** Steps 1–3 (token-log, human-input-log, process-improvements) are the ones silently skipped, because step 4 is the only one with a visible artefact the human notices missing. Skipping them loses exactly the material that stops the same cost recurring — which is the whole point of the sequence.

- **Do not report the slice as finished, and never print `✅ READY TO CLOSE`, while any step is outstanding.** "Status tables updated" is step 4 of 9, not Scribe.
- **State each step's outcome explicitly** — done, or N/A and why (e.g. "step 5 N/A — no projection added"). An unmentioned step reads as skipped, because it usually was.
- **Steps 5, 6 and 7-full are conditional**; 1, 2, 3, 4, 8 and 9 are not. If a conditional step does not apply, say so rather than passing over it.
- **Run the sequence in order.** Step 3 consumes step 1's spikes and step 2's avoidable rows as inputs; running it first produces a learnings doc missing the costs it exists to capture.
- If a step genuinely cannot be completed (missing data, an API you cannot reach), that is an `ACTIONS FOR YOU` entry in the hand-off with its `Why it needs you:` line — not a silent omission.

## Sequence

1. **[`token-log`](./../token-log/SKILL.md)** — collect agent token counts, append to `docs/token-log.md`, identify spikes.
2. **[`human-input-log`](./../human-input-log/SKILL.md)** (capture mode) — drain the live permission rows for this slice's branch, reconstruct the gate/clarification/decision/unblock rows from the session, append to `docs/human-input-log.md`. Hand every `Avoidable? = Yes` row to step 3.
3. **[`process-improvements`](./../process-improvements/SKILL.md)** — permission audit + learnings doc + execute Done actions. Pass any spike observations from step 1 **and the avoidable human-input rows from step 2** as inputs.
4. **Update progress tracking:**
   - `docs/phases/phase-N.md` — **update that slice's `Status` cell in the `## Summary` table** (the authoritative status) and mark every completed acceptance criterion `[x]` in the slice's `## Build notes` block. The review surface carries no per-slice status line — the table is the single source; if a legacy doc still has a per-slice `**Status:**` line, keep it in agreement with the table. **When you write or extend a row in any standing tracking doc, check it opens with the user-visible symptom in plain language** — these tables are that doc's review surface and the human reads the `Summary` column to set priority. If the first clause names a file, log group, table, event, stream version or status code, rewrite the opening and push the mechanism after it; the facts stay, the order changes. **Keep the row to one or two lines** and put diagnosis, evidence, ruled-out causes and status history in that item's detail section below the table — never in the cell. See `## Writing style` in `CLAUDE.md`.
   - **A fixed bug is ARCHIVED, not marked Done in place.** Condense it into [`docs/phases/phase-bugs-archive.md`](../../../docs/phases/phase-bugs-archive.md) as one `## BUG-N` entry — what the user hit → why → what fixed it, plus PR and deploy number — then **delete both its Summary row and its detail section** from `phase-bugs.md`, which carries open defects only. Keep the heading text stable so inbound `#bug-N` anchors resolve. Same shape for a completed `technical-improvements.md` item → `technical-improvements-archive.md`. `scripts/check-doc-ids.sh` fails the commit if an id ends up in both files, so run it before committing. For `phase-minor-changes.md` (no archive), mark the item Done in its row.
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
8b. **Ask a peer before writing anything into the hand-back.** Scribe's blockers are almost always peer-shaped — a doc row someone else claimed, a shared checkout mid-edit, a commit whose owner is unclear, a status you would otherwise guess at. **Never attribute work to a session without asking it**; three misattributions in one day each came from assuming, and one restored a row against its owner's intent. Only what survives "no peer can answer this" reaches the human. See rule 5 of `### When NOT to hand back` in CLAUDE.md.
9. **Hand off** — first verify the tree is clean of Scribe's own work: `git status` must show **no uncommitted doc Scribe wrote or edited** (a human's pre-existing WIP may remain, by name). Then hand back using the block in **CLAUDE.md `## Handing back to the human`** — that block is the entire hand-off, and nothing follows it. Run the `✅ READY TO CLOSE` checklist honestly; a TODO left for the human is an `ACTIONS FOR YOU` entry with its `Why it needs you:` line, never a passing mention. Learnings paths, Done-action counts and condensed-doc lists are evidence, not news — they do not go in the block.

## What Scribe does NOT do

- Change feature code, tests, the event model, or CDK stacks
- Update README from memory — verify against source files first
