# Phase Model & Prompt Improvements — Analysis quality backlog

**Goal:** A standing, unnumbered phase that captures iterative improvements to the AI analysis — new prompt versions, model swaps, and judge/eval changes — driven by what the [eval harness (10-G)](phase-10.md#slice-10-g--analysis-evaluation-harness) measures. Unlike a numbered phase this has no end: as long as analysis quality can be pushed higher, items are added here, evaluated with `make eval`, and marked Done as the winning prompt/model ships. Each item is still proven the normal way — measured against fixed transcripts via the harness before anything ships.

**What belongs here:** changes whose goal is *better analysis output* and whose evidence is an eval run — a new `analysis@vN` prompt, adopting/dropping a candidate model, changing the Quality judge, or tuning extraction precision from the captured feedback signal (10-I → 10-L). If it's new user-facing capability it's a **feature** ([docs/future-features.md](../future-features.md) → a numbered phase); a defect is a **bug** ([docs/phases/phase-bugs.md](phase-bugs.md)); a small behaviour/appearance tweak is a **minor change** ([docs/phases/phase-minor-changes.md](phase-minor-changes.md)); a refactor/infra/CI item is a **technical improvement** ([docs/technical-improvements.md](../technical-improvements.md)).

**Learning surface:** prompt engineering as a measured discipline — every change is justified by an eval delta, not taste. The companion artefacts are [`docs/eval-runs/`](../eval-runs/) (per-run decision reports) and [`docs/eval-runs/test-matrix.md`](../eval-runs/test-matrix.md) (the versioned set of models/prompts under test). Both are maintained by the [`eval-run`](../../.claude/skills/eval-run/SKILL.md) skill, which also appends the next suggested item here after each run.

---

## Summary

| Item | Summary | Status | Depends on |
|------|---------|--------|------------|
| MPI-1 | `analysis@v4` — deepen note content (the universal weak dimension) | Open | 10-G, 10-O |

Further items are appended as each eval run surfaces the next weakest dimension. The `eval-run` skill proposes them (see [How items are added](#how-items-are-added)).

---

## How items are added

This backlog is fed by the eval loop, not drafted up front. After each `make eval` run, the [`eval-run`](../../.claude/skills/eval-run/SKILL.md) skill:

1. Writes the per-run decision report under `docs/eval-runs/` and updates `test-matrix.md`.
2. Derives the **next suggested improvement** — usually targeting the weakest Quality dimension, or a model worth adding/dropping — and **checks with the user** before recording it.
3. On the user's go-ahead, appends a new `MPI-N` row to the Summary table above and a detail section below, citing the eval run that motivated it.

Items are never deleted — a shipped or abandoned item is marked `Done`/`Dropped` with the deciding eval run, so the history of what was tried (and why) survives alongside `test-matrix.md`.

---

## MPI-1 — `analysis@v4`: deepen note content

**Status:** Open

**Value:** Across **every** model and both prompts, **Content** is the only Quality dimension still below ~0.75 — the universal weak spot (see the frontier `v2`-vs-`v3` run, [docs/eval-runs/2026-06-04-frontier-v2-v3.md](../eval-runs/2026-06-04-frontier-v2-v3.md)). Because all models share it, it's a *prompt* problem, not a model one. Draft `analysis@v4` that pushes for fuller capture of the discussion's substance (not headline-only), measure v3-vs-v4 with the harness, keep the winner.

**The two failure modes the run-468475 outputs actually show** (read the low-`qualityContent` rows + `run-468475-outputs.md`): content is penalised for **both**, and they pull in opposite directions —
1. **Thinness (dominant):** the discussion is reduced to topic labels with no substance — e.g. the `01-standup` note's whole discussion was `- Login bug` / `- Updating docs`. Judge: *"far too thin, lacking detail and depth"*.
2. **Fabrication on sparse transcripts:** on short fixtures (`17-budget-review`, `14-all-hands-reorg`) models invent ungrounded detail — e.g. Opus hallucinated a company name, *"Cyberdyne"*, and even emitted it as a tag. Judge: *"adds ungrounded content"* → content 0.20.

So v4 must chase **depth where the source supports it and restraint where it doesn't** — "fuller capture" alone would make the sparse-transcript cases worse. Note also that **Faithfulness did not catch the fabrication** (it scored 1.00 on the Cyberdyne row); only the LLM judge's `qualityContent` did. So this run's faithfulness column can't be used to confirm v4 didn't regress grounding — that gap is its own follow-up (a candidate **MPI-2**: a fabrication/grounding probe the harness can detect).

**Commands in scope:** none · **Events in scope:** none

### Scope
- Add `PromptCatalog.V4` (`analysis@v4`) — same structured output as V3. Two paired instruction changes:
  - **Depth:** capture the *substance* of each discussion point (the what + the why / the number / the context), not a bare topic label; include an explicit **deep-vs-shallow contrast** example in the prompt so the model sees the target.
  - **Grounding restraint:** include only what the transcript/note supports; never invent names, numbers, companies, or commitments; when the transcript is thin, a short note is correct — do **not** pad. Preserve V3's minimal-tags rule and its "only the current user's actions, omit if ambiguous" rule.
- Compare via the harness: `Prompts = [V3, V4]`, `EVAL_PRESET=frontier`, read `report.md` — target the **Content** column rising **without** regressing Tags / Actions / Decisions, **and** without the sparse fixtures (`17-budget-review`, `14-all-hands-reorg`) sprouting invented detail (eyeball their `-outputs.md` sections, since faithfulness won't flag it).
- If V4 wins, ship it (switch `PromptCatalog.Current`, as 10-O did for V3) and record the decision via the `eval-run` skill in `docs/eval-runs/`. Otherwise iterate.

- [ ] V4 mean Content beats V3 across the frontier models, no regression on Tags / Actions / Decisions
- [ ] No new fabrication on the sparse fixtures vs V3 (manual check of their outputs)
- [ ] Decision recorded in `docs/eval-runs/` and `test-matrix.md` updated

**Depends on:** 10-G (the harness), 10-O (ship `analysis@v3` first so V4 iterates from the shipped baseline).
