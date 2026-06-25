# Eval run — MPI-5 programmatic note-grounding confirmation

**What this run was for:** to check that the MPI-5 fix worked. The eval uses an AI "judge" to score each generated note. That judge had a bug — it counted facts the user had already written in their own note as if the AI had made them up, wrongly tanking the score. MPI-5 (#257) fixed it by handing the judge the known-good keywords up front. **It worked:** the worst-hit test note went from a content score of 0.20 to 0.70–0.90 on every model. This was a fix to the *measurement*, not to the app — nothing the end user sees changed.

**Recommended changes coming out of this run:**

| Change | Do it? | Plain reason |
|--------|--------|--------------|
| **Improve note tags** (reword the tagging prompt — MPI-6) | **Yes, next** | Tagging is the AI's weakest output on every model (0.53–0.72 vs 0.85+ for everything else). Tags are how you find related notes later, so this is the one change that meaningfully lifts note quality. Prompt-only, cheap. |
| **Switch the production model** (Nova Lite → Sonnet-4-6) | **No** | Sonnet scored only 0.012 higher than the cheap Nova Lite we already run — too small to matter, at much higher cost per note. |
| **Drop Mistral from the test set** | **Not yet** | It's the weakest and the only non-Anthropic model, but that's exactly why it's useful — it's our cross-check against the (Anthropic) judge favouring its own family. Revisit after MPI-6. |

No model or prompt change ships from this run; `analysis@v5` stays live. The next action is MPI-6.

## 1. Run metadata

| Field | Value |
|-------|-------|
| Date | 2026-06-13 |
| Run id | `run-78385` |
| Fixtures | 22, all **synthetic** (named `NN-…`); gold labels present → F1 columns valid |
| Prompt | `analysis@v5` only (judge-fix confirmation, not a prompt comparison) |
| Models swept | keep-set: `claude-opus-4-6-v1`, `claude-sonnet-4-6`, `mistral-large-2402`, `nova-lite-v1:0` |
| Quality judge | `anthropic.claude-3-7-sonnet-20250219-v1:0` (held out of candidates) **with the MPI-5 allowlist** (#257) |
| Caveats | All 22 fixtures completed per cell — no throttling skips. Single prompt, so no prompt-delta this run. Judge is Anthropic → mild family-bias toward the two Claude models. |

**What changed since `run-28225`:** the judge now receives the fixture's gold tags (humanised) as a `GROUNDED ENTITIES — NEVER flag as fabrication` allowlist. Nothing else changed (same prompt, same models, same judge model).

## 2. Results (best Quality first)

| Prompt | Model | Quality | Tags | Actions | Decisions | Content | Faithfulness | Fixtures |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| analysis@v5 | anthropic.claude-opus-4-6-v1 | 0.875 | 0.686 | 0.991 | 0.882 | 0.889 | 0.976 | 22 |
| analysis@v5 | anthropic.claude-sonnet-4-6 | 0.862 | 0.720 | 0.982 | 0.873 | 0.861 | 0.985 | 22 |
| analysis@v5 | amazon.nova-lite-v1:0 | 0.850 | 0.686 | 0.968 | 0.882 | 0.857 | 0.941 | 22 |
| analysis@v5 | mistral.mistral-large-2402-v1:0 | 0.805 | 0.527 | 0.973 | 0.786 | 0.848 | 0.972 | 22 |

### The MPI-5 fix — sparse-fixture content vs faithfulness

| Fixture | Model | qContent (run-28225) | qContent (run-78385) | Faithfulness |
|---------|-------|---------------------:|---------------------:|-------------:|
| `14-all-hands-reorg` | sonnet-4-6 | 0.20 | **0.80** | 1.00 |
| `14-all-hands-reorg` | opus-4-6 | (mis-flagged) | **0.90** | 1.00 |
| `14-all-hands-reorg` | mistral-large | — | **0.70** | 1.00 |
| `14-all-hands-reorg` | nova-lite | — | **0.90** | 1.00 |
| `17-budget-review` | all 4 | terseness-fixed only | **0.80–0.90** | 1.00 |

The note/gold entity ("Stark Industries", in the user note + gold tags) is no longer counted as fabrication — content now tracks faithfulness instead of collapsing to 0.20.

## 3. Column glossary

| Column | Measures | Trust | Decision weight |
|--------|----------|-------|-----------------|
| Quality | Holistic rubric score (judge) | High — headline metric | Primary |
| Tags | Minimal high-signal tag set | High | Primary — the **universal weak dimension** (0.527–0.720) |
| Actions | Only the user's own commitments, accurate | Medium — **saturated** (0.968–0.991) | Low |
| Decisions | Actual decisions, accurate/complete | High | Secondary |
| Content | Substance vs source, thinness judged relative to source | High — **the dimension MPI-5 unblocked** | Primary |
| Faithfulness | Fraction of claims supported by source | **Saturated** (0.941–0.985) — no signal | None (confirms no fabrication only) |
| Fixtures | Completed cells | n/a | All 22 → fully reliable this run |

## 4. Model summary

Ranking (Quality): **Opus 0.875 > Sonnet 0.862 > Nova Lite 0.850 > Mistral 0.805.**

| Model | Strengths | Weaknesses | Keep/Drop |
|-------|-----------|------------|-----------|
| `claude-opus-4-6` | Top Quality + Content (0.889) | Tags 0.686; most expensive | **Keep** — quality ceiling reference |
| `claude-sonnet-4-6` | Best Tags (0.720), top Faithfulness; value pick | Content slightly below Opus | **Keep** — value pick |
| `nova-lite` | Cheap; within 0.025 of Sonnet on Quality | Tags 0.686; lowest Faithfulness | **Keep** — production baseline |
| `mistral-large` | — | Weakest everywhere; **Tags 0.527** outlier | **Drop candidate** — see MPI proposal |

- **Universal weak dimension: Tags** (0.527–0.720) — the only dimension below ~0.75 on every model; a prompt problem, not a model one (carried from MPI-2).
- Opus edging Sonnet here (vs Sonnet leading in `run-28225`) is within single-run + family-bias noise; this run is a judge-fix confirmation, not a model-selection run — no model decision is taken on it.

## 5. Prompt summary

- Single prompt (`analysis@v5`) — no prompt comparison this run.
- `analysis@v5` stays current (shipped MPI-2, `run-551897`). The MPI-5 change was judge-side; it does not alter what `analysis@v5` produces, only how faithfully thin-transcript content is scored.
- **Next prompt target: Tags.** It is now the lone sub-0.75 dimension on every model. A `analysis@v6` tag-discipline pass (or dropping the weak-tags Mistral) is the next lever.

## 6. Caveats & confidence

- **Fixture counts even** (22/22 per cell) — high confidence within the synthetic corpus.
- **Judge family-bias:** the judge is Anthropic; the two Claude models top the table. The MPI-5 *conclusion* (sparse-fixture content no longer mis-flagged) is bias-immune — it is a within-model before/after on the same judge family, and faithfulness is 1.00 on those cells regardless. A held-out non-vendor judge would only matter for settling the Opus-vs-Sonnet ordering, which this run does not decide.
- **Synthetic only** — no real-meeting fixtures this run.
- **Single run** — per-cell scores carry judge variance; the 0.20→0.80+ jump on `14-all-hands-reorg` is far larger than that variance, so the fix is unambiguous.
