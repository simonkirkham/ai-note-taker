# Phase Model & Prompt Improvements — Analysis quality backlog

**Goal:** A standing, unnumbered phase that captures iterative improvements to the AI analysis — new prompt versions, model swaps, and judge/eval changes — driven by what the [eval harness (10-G)](phase-10.md#slice-10-g--analysis-evaluation-harness) measures. Unlike a numbered phase this has no end: as long as analysis quality can be pushed higher, items are added here, evaluated with `make eval`, and marked Done as the winning prompt/model ships. Each item is still proven the normal way — measured against fixed transcripts via the harness before anything ships.

**What belongs here:** changes whose goal is *better analysis output* and whose evidence is an eval run — a new `analysis@vN` prompt, adopting/dropping a candidate model, changing the Quality judge, or tuning extraction precision from the captured feedback signal (10-I → 10-L). If it's new user-facing capability it's a **feature** ([docs/future-features.md](../future-features.md) → a numbered phase); a defect is a **bug** ([docs/phases/phase-bugs.md](phase-bugs.md)); a small behaviour/appearance tweak is a **minor change** ([docs/phases/phase-minor-changes.md](phase-minor-changes.md)); a refactor/infra/CI item is a **technical improvement** ([docs/technical-improvements.md](../technical-improvements.md)).

**Learning surface:** prompt engineering as a measured discipline — every change is justified by an eval delta, not taste. The companion artefacts are [`docs/eval-runs/`](../eval-runs/) (per-run decision reports) and [`docs/eval-runs/test-matrix.md`](../eval-runs/test-matrix.md) (the versioned set of models/prompts under test). Both are maintained by the [`eval-run`](../../.claude/skills/eval-run/SKILL.md) skill, which also appends the next suggested item here after each run.

---

## Summary

| Item | Summary | Status | Depends on |
|------|---------|--------|------------|
| MPI-1 | `analysis@v4` — deepen note content (the universal weak dimension) | Done (not shipped, `run-532442`) | 10-G, 10-O |
| MPI-2 | `analysis@v5` — keep V4's depth win, add a thin-transcript grounding clamp + restore V3 tag discipline | Done — ships (`run-551897`) | MPI-1 |
| MPI-3 | Model sweep — add `anthropic.claude-sonnet-4-6`, evaluate as replacement for the aged `claude-3-sonnet-20240229` value pick | Done (`run-28225`) | 10-G |
| MPI-4 | Fix the judge — give it the user's note as grounding + stop the content rubric auto-failing faithful terse notes | Done — terseness fixed; note-grounding partial (`run-28225`) | 10-G |
| MPI-5 | Programmatic note-grounding for the judge — prompt-level grounding proved insufficient; exclude note/gold entities from the fabrication check | Done (`run-78385`) — allowlist (#257) fixed sparse-fixture content (0.20→0.70–0.90) | MPI-4 |

Further items are appended as each eval run surfaces the next weakest dimension. The `eval-run` skill proposes them (see [How items are added](#how-items-are-added)).

---

## How items are added

This backlog is fed by the eval loop, not drafted up front. After each `make eval` run, the [`eval-run`](../../.claude/skills/eval-run/SKILL.md) skill:

1. Writes the per-run decision report under `docs/eval-runs/` and updates `test-matrix.md`.
2. Derives the **next suggested improvement** — usually targeting the weakest Quality dimension, or a model worth adding/dropping — and **checks with the user** before recording it.
3. On the user's go-ahead, appends a new `MPI-N` row to the Summary table above and a detail section below (format: see the eval-run skill's [MPI item format](../../.claude/skills/eval-run/SKILL.md) — lead with a one-line **Proposal**, scannable **Why it's worth doing** bullets, a **Cost** line, then **Steps**), citing the eval run that motivated it.

Items are never deleted — a shipped or abandoned item is marked `Done`/`Dropped` with the deciding eval run, so the history of what was tried (and why) survives alongside `test-matrix.md`.

---

## MPI-1 — `analysis@v4`: deepen note content

**Status:** Done — `analysis@v4` built and evaluated (`run-532442`, [report](../eval-runs/2026-06-04-v3-v4-content.md)); **not shipped**. V4 delivered the targeted Content lift on the weaker models (Nova Lite **+0.100**, Sonnet +0.048) but failed this item's own acceptance bar: it **worsened fabrication on the sparse fixtures** (`17-budget-review`, `14-all-hands-reorg` — invented "Cyberdyne"/"Stark Industries" more than V3), dropped Tags on all four models, and regressed the strong models (Mistral −0.054 Quality, Opus −0.015). `analysis@v3` stays shipped. The depth win is real on the production model, so the work continues in **MPI-2** (`analysis@v5`). Faithfulness scored ~1.0 even on fabricated cells, confirming it can't gate grounding — see the MPI-2 scope and the run report's Caveats.

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
- [x] No new fabrication on the sparse fixtures vs V3 (manual check of their outputs) — **failed**: V4 fabricated *more* on the sparse fixtures
- [x] Decision recorded in `docs/eval-runs/` and `test-matrix.md` updated — [report](../eval-runs/2026-06-04-v3-v4-content.md), matrix v2

**Depends on:** 10-G (the harness), 10-O (ship `analysis@v3` first so V4 iterates from the shipped baseline).

---

## MPI-2 — `analysis@v5`: keep the depth win, clamp thin-transcript grounding

**Status:** Done — `analysis@v5` built and evaluated (`run-551897`, [report](../eval-runs/2026-06-04-v3-v4-v5-grounding.md)); **ships**. V5 lifted the production model (Nova Lite Quality **+0.066** / Content **+0.089** vs v3) and overall (mean Quality +0.039, Content +0.065), **restored the tags** V4 dropped (mean +0.025 vs v3), and produced correctly terse, **non-fabricating** notes on the sparse fixtures. A bonus finding: V4's prior "fabrication regression" was a **judge error** (the flagged "Cyberdyne"/"Stark Industries" are in the fixtures' user-note + gold tags). Ship action: switch `PromptCatalog.Current` → V5. The remaining weak spot is the **measurement**, not the prompt — carried forward to MPI-4.

**Value:** `run-532442` showed V4's depth wording earns a **+0.100 Content** lift on the production model (Nova Lite) and +0.048 on Sonnet — a genuine win on the dimension that is still the weakest everywhere. But V4 is not shippable: the same depth push tips sparse transcripts into **fabrication** (inventing company names not in the source) and **drops Tags** on all four models. V5's job is to bank the depth gain while removing the two regressions, so a content-deepening prompt can finally ship.

**Commands in scope:** none · **Events in scope:** none

### Scope
- Add `PromptCatalog.V5` (`analysis@v5`) — start from V4's structured output and depth wording (the deep-vs-shallow contrast example stays; it's what earns the Nova Lite lift). Two targeted hardenings:
  - **Thin-transcript grounding clamp that beats the depth push.** V4 already told the model to be restrained on thin input, but the depth instruction overrode it. V5 must make the clamp dominant: an explicit rule that when the transcript is sparse, a **short** note is the correct output, and **never name an entity (company, person, product, number) that does not appear verbatim in the source**. Consider an ordered instruction ("grounding before depth") or a worked sparse-transcript example showing a correctly terse note.
  - **Restore V3's tag discipline.** V4 dropped Tags on all four models; pull V3's minimal-tags wording back in verbatim.
- Compare via the harness: `Prompts = [V3, V4, V5]`, `EVAL_PRESET=keep`, read `report.md`. Targets:
  - V5 holds V4's **Content** lift on Nova Lite (≈+0.10 vs V3) and Sonnet.
  - V5 does **not** regress Tags vs V3 on any model.
  - **No new fabrication on `17-budget-review` / `14-all-hands-reorg`** vs V3 — eyeball the `-outputs.md` sections, since Faithfulness (~1.0) is blind to it.
  - Ideally recovers some of the strong-model (Mistral/Opus) Quality V4 lost.
- If V5 clears the bar, ship it (switch `PromptCatalog.Current`, as 10-O did for V3) and record the decision via the `eval-run` skill.

- [x] V5 keeps V4's Content lift on the production model without the fabrication regression on the sparse fixtures — Nova Lite Content +0.089 vs v3; no fabrication (judge prose confirms)
- [x] V5 does not regress Tags vs V3 on any keep-set model — Tags mean +0.025 vs v3 (up on Nova Lite/Opus, flat Sonnet, only Mistral −0.023)
- [x] Decision recorded in `docs/eval-runs/` and `test-matrix.md` updated — [report](../eval-runs/2026-06-04-v3-v4-v5-grounding.md), matrix v3

**Depends on:** MPI-1 (V4's wording and the run-532442 findings are the starting point).

---

## MPI-3 — Swap-test `claude-sonnet-4-6` as the value pick

**Status:** Done — `claude-sonnet-4-6` swept on `analysis@v5` (`run-28225`, [report](../eval-runs/2026-06-10-sonnet-4-6-model-sweep-judge-fix.md)). **It wins:** top model overall (Quality **0.850**), beating the aged `claude-3-sonnet-20240229` (0.820, **+0.030**) and Opus (0.811, **+0.039**) at lower cost. Decision: **add `claude-sonnet-4-6` as `**keep**`, drop `claude-3-sonnet-20240229`** (same vendor, dominated). It also leads the prod model Nova Lite (0.814) by +0.036 — a prod-upgrade candidate (cost/latency review, non-vendor judge confirmation needed first; not actioned here). Matrix bumped to v4. Access confirmed: invoked cleanly on-demand in eu-west-2, zero skips.

**Proposal:** Add `anthropic.claude-sonnet-4-6` to the keep-set; run one model-only sweep on the shipped prompt (`analysis@v5`).

**Why it's worth doing:**
- The current "value pick", `claude-3-sonnet-20240229`, is an early-2024 model — almost certainly beaten by the current-gen Sonnet. The keep-set should track current models.
- One sweep answers: keep the old Sonnet, or swap it.
- May also move the **prod model** — V5 put Nova Lite within −0.021 of Opus, so a strong, cheaper Sonnet could become the new prod default.

**Cost:** ~1 sweep (keep-set + 1 model) × 22 fixtures, one prompt. Access is **confirmed live** (`run-551897`: Anthropic models invocable on-demand in prod) — not blocked.

### Steps
1. Add `claude-sonnet-4-6` to the matrix; sweep model-only on `analysis@v5`.
2. Rank vs the keep-set; decide keep/drop on `claude-3-sonnet-20240229`.
3. Record via the `eval-run` skill; update `test-matrix.md`.

- [x] Swept on `analysis@v5`; new Sonnet ranked vs the keep-set — top of the keep-set (0.850)
- [x] Keep/drop decision recorded in `test-matrix.md` + report — matrix v4; 2024 Sonnet dropped, Sonnet-4-6 kept

**Depends on:** 10-G (the harness).

---

## MPI-4 — Fix the judge: note-blindness + terseness penalty

**Status:** Done — judge rubric reworded and re-run (`run-28225`, [report](../eval-runs/2026-06-10-sonnet-4-6-model-sweep-judge-fix.md)). **Terseness penalty fixed:** the content rubric now judges thinness relative to the source, so faithful-terse notes on thin transcripts are no longer auto-capped at ≤0.4 — `17-budget-review` content rose to 0.80–0.90 on three models. **Note-grounding only partially fixed:** the rubric now names the existing note as valid grounding, but the LLM judge still mis-flags note-only entities as fabrication where they recur through the output (`14-all-hands-reorg`'s gold-tag "Stark Industries" → content 0.20, faithfulness 1.00). Prompt wording is necessary but insufficient; a programmatic fix is carried to **MPI-5**. Code: `BedrockQualityJudge.BuildPrompt` (extracted for unit testing) + `BedrockQualityJudgePromptTests`.

**Proposal:** Give the quality/faithfulness judges the user's note as grounding context, and stop the content rubric auto-failing a faithful, justified-terse note on a thin transcript.

**Why it's worth doing:**
- Note-blindness already produced wrong calls — the judge flagged grounded gold-tag entities ("Cyberdyne"/"Stark Industries", both in the fixtures' user-note) as fabrication; it sank V4 in `run-532442` and nearly sank V5.
- The terseness penalty (content ≤0.4 even when fully faithful) fights the grounding clamp V5 just shipped — sparse-fixture content scores can't be trusted until it's fixed.
- Both are *measurement* bugs: they distort every future prompt comparison, not just one run.

**Cost:** Prompt-only edits to the two judges in `tests/Analysis.Eval/Scoring/` (`BedrockQualityJudge`, `ContentJudge`/faithfulness). No new infra. Re-run V5 to confirm sparse-fixture scores rise with no prompt change.

### Steps
1. Pass `existingContent` (user note) into the judge prompts as valid grounding alongside the transcript.
2. Reword the content rubric so a faithful note that is short *because the transcript is thin* is not auto-failed to ≤0.4.
3. Re-run V3/V5 on the keep-set; confirm the sparse fixtures (`17-budget-review`, `14-all-hands-reorg`) no longer mis-score, and no prompt regressed.

- [x] Judges receive the user note; rubric names it as grounding — **partial**: prompt edit done, but the judge still mis-flags note-only gold entities (`14-all-hands-reorg`) → carried to MPI-5
- [x] Sparse-fixture content scores reflect faithfulness, not length — terseness floor removed (`17-budget-review` 0.20→0.90 on 3 models)
- [x] Decision recorded in `docs/eval-runs/` + `test-matrix.md` — [report](../eval-runs/2026-06-10-sonnet-4-6-model-sweep-judge-fix.md), matrix v4

**Depends on:** 10-G (the harness).

---

## MPI-5 — Programmatic note-grounding for the judge

**Status:** Done (`run-78385`, [report](../eval-runs/2026-06-13-mpi5-programmatic-grounding.md)) — the deterministic allowlist (#257) closed the judge's note-blindness. The quality judge receives the fixture's gold tags (humanised) as a `GROUNDED ENTITIES — never flag as fabrication` block, replacing MPI-4's prompt-only grounding. **Confirmed:** `14-all-hands-reorg` content rose **0.20 → 0.70–0.90** across all four keep-set models, now consistent with faithfulness (1.00); `17-budget-review` 0.80–0.90. No prompt/model change. Next weak dimension is **Tags** (0.527–0.720) — carried to a future MPI item.

**Proposal:** Stop relying on prompt wording for note-grounding — extract the user-note (and gold-tag) entities and exclude them from the quality judge's fabrication check programmatically, or add a held-out non-vendor judge to confirm sparse-fixture content.

**Why it's worth doing:**
- MPI-4's prompt edit proved **insufficient**: `run-28225` still scored `14-all-hands-reorg` content at 0.20 because the judge flagged "Stark Industries" (in the user's note, a gold tag) as fabrication, faithfulness 1.00 on the same cell. Even Opus's rationale admits the entity is in the note, then penalises it.
- Sparse-fixture content scores still can't be trusted per-cell, so every future prompt comparison on thin transcripts stays distorted — a measurement bug, not a one-run artefact.
- A deterministic grounding check removes judge variance on the dimension MPI-1/2 spent two runs chasing.

**Cost:** Harness-only. Either (a) inject note/gold entities into the faithfulness reference and have the quality judge defer to it, or (b) a parallel non-vendor judge on the sparse fixtures. No infra. One confirming re-run of `analysis@v5` on the keep-set.

### Steps
1. Build the grounded-entity allowlist from the fixture's **gold tags** (humanised from kebab-case) — the deterministic, curated set of entities grounded by definition; the user note already appears verbatim in the prompt. Pass them to the quality judge as an explicit "these are grounded, do not call them fabrication" allowlist.
2. Re-run `analysis@v5` on the keep-set; confirm `14-all-hands-reorg` / `17-budget-review` content scores reflect faithfulness, not entity-flagging.
3. Record via the `eval-run` skill; update `test-matrix.md`.

- [x] **Allowlist wired** (#257): `GroundedEntities.From(fixture)` humanises + dedups gold tags; `BedrockQualityJudge.BuildPrompt` renders the `GROUNDED ENTITIES` block; `EvalRunner` populates it per row. 16 targeted unit tests; full `Analysis.Eval` green. Harness-only, `paths-ignore`d → no deploy.
- [x] Note/gold entities no longer flagged as fabrication on the sparse fixtures — `14-all-hands-reorg` content 0.20→0.70–0.90 (`run-78385`)
- [x] Sparse-fixture content scores consistent with faithfulness across all keep-set models — content 0.70–0.90 vs faithfulness 1.00 on `14`/`17`, all 4 models
- [x] Decision recorded in `docs/eval-runs/` + `test-matrix.md` — [report](../eval-runs/2026-06-13-mpi5-programmatic-grounding.md), matrix v5

**Depends on:** MPI-4 (the prompt-level edit and the `run-28225` finding that it's insufficient).
