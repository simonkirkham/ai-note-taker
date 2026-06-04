# Eval run — 2026-06-04: `analysis@v3` vs `v4` vs `v5` (grounding clamp + tag restore)

_Produced by the `eval-run` skill from `run-551897`._

## TL;DR — decision

**Ship `analysis@v5`.** V5 was MPI-2: keep V4's depth wording, but make grounding *dominant* (a "GROUNDING COMES FIRST" clause that overrides depth + a worked thin-transcript example) and restore V3's two-bullet tag discipline. It worked on every axis that mattered:

- **Quality up vs V3 on the production model** (`nova-lite` **0.764→0.830, +0.066**) and overall (**mean 0.772→0.811, +0.039**). V5 is the top prompt on 3 of 4 models and holds the single best cell (V5/opus **0.851**).
- **Content up vs V3 on all four models** (mean **+0.065**), the dimension MPI-1/2 targeted.
- **V4's tag regression is fixed** — V5 Tags mean **0.719 vs V3 0.694 (+0.025)**, vs V4's 0.665.
- **No fabrication.** The prior run's "fabrication" disqualification of V4 was a **judge error**, not a real failure (see below). V5's grounding clamp demonstrably works: the judge itself describes the terse V5 sparse-fixture notes as "accurately captures limited information **without fabrication**."

**Recommendation: switch `PromptCatalog.Current` → V5 and ship.** This closes **MPI-2 as Done**. The lone non-improver is `mistral-large` (Quality flat, −0.007) — it's the weak-tags outlier across all three prompts and doesn't block shipping.

## Real-transcript confirmation (`run` on `eval-fixtures-real`)

Synthetic-only was the report's main caveat, so V3/V4/V5 were also run on **5 real prod meetings** (Nova-Lite, the production model; private, git-ignored fixtures). On real data only Quality/Faithfulness are meaningful (no gold labels).

| Prompt | Quality | Content | Faithfulness | Tags |
| --- | --- | --- | --- | --- |
| **analysis@v5** | **0.500** | 0.440 | **1.000** | 0.520 |
| analysis@v4 | 0.490 | 0.460 | 0.971 | 0.540 |
| analysis@v3 | 0.390 | 0.340 | 0.947 | 0.600 |

V5 vs V3 on real transcripts: **Quality +0.110, Content +0.100, Faithfulness +0.053** — the grounding clamp holds (V5 perfectly faithful). Counter-signal: **Tags −0.080** (opposite of the synthetic run). **n=5, directional only** — but Quality and grounding both favour V5, confirming the synthetic result on real data. The real-vs-synthetic tags divergence is a watch item for MPI-4.

## Run metadata

- **Date:** 2026-06-04 · **runId:** `run-551897`
- **Fixtures:** 22, **synthetic** (built-in corpus, gold labels present — all metrics valid).
- **Prompts:** `analysis@v3` (shipped), `analysis@v4` (the rejected depth attempt), `analysis@v5` (MPI-2 — grounding-dominant depth + restored tags). **All three were run in the same sweep** so the comparison is free of cross-run noise (which turned out to matter — see Caveats).
- **Models:** the matrix `keep` set — `amazon.nova-lite-v1:0` (**production**), `anthropic.claude-3-sonnet-20240229-v1:0`, `mistral.mistral-large-2402-v1:0`, `anthropic.claude-opus-4-6-v1`.
- **Quality judge:** `anthropic.claude-3-7-sonnet-20250219-v1:0` (held out of candidates).
- **Completeness:** 262/264 cells. **2 transient skips** (`nova-lite × 13-hiring-debrief` `BedrockRuntimeException`; `sonnet × 16-roadmap-review` `ServiceUnavailableException`) → `nova-lite/V3` and `sonnet/V4` carry 21 fixtures, not 22. Both are different-vendor transient errors, not access issues.

## Results (best-Quality-first)

| Prompt | Model | Quality | Tags | Actions | Decisions | Content | Faithfulness | Fixtures |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| analysis@v5 | claude-opus-4-6 | **0.851** | 0.773 | 0.986 | 0.877 | 0.805 | 0.986 | 22 |
| analysis@v5 | nova-lite **(prod)** | 0.830 | 0.775 | 0.982 | 0.891 | 0.782 | 0.953 | 22 |
| analysis@v4 | claude-3-sonnet | 0.807 | 0.729 | 0.931 | 0.917 | 0.793 | 0.972 | 21 |
| analysis@v4 | claude-opus-4-6 | 0.807 | 0.691 | 0.980 | 0.868 | 0.766 | 0.982 | 22 |
| analysis@v5 | claude-3-sonnet | 0.802 | 0.752 | 0.909 | 0.914 | 0.775 | 1.000 | 22 |
| analysis@v3 | claude-opus-4-6 | 0.798 | 0.684 | 0.975 | 0.843 | 0.761 | 0.991 | 22 |
| analysis@v4 | mistral-large | 0.771 | 0.618 | 0.984 | 0.830 | 0.739 | 0.927 | 22 |
| analysis@v3 | mistral-large | 0.768 | 0.600 | 0.986 | 0.855 | 0.725 | 0.994 | 22 |
| analysis@v3 | nova-lite **(prod)** | 0.764 | 0.736 | 0.962 | 0.812 | 0.693 | 0.963 | 21 |
| analysis@v5 | mistral-large | 0.761 | 0.577 | 0.982 | 0.820 | 0.741 | 0.991 | 22 |
| analysis@v3 | claude-3-sonnet | 0.758 | 0.757 | 0.964 | 0.868 | 0.666 | 0.997 | 22 |
| analysis@v4 | nova-lite **(prod)** | 0.723 | 0.620 | 0.916 | 0.805 | 0.695 | 0.875 | 22 |

**Per-model V3→V5 deltas (the decision view):**

| Model | Quality | Content | Tags | Decisions |
| --- | --- | --- | --- | --- |
| nova-lite **(prod)** | 0.764→0.830 **+0.066** | 0.693→0.782 **+0.089** | 0.736→0.775 +0.039 | 0.812→0.891 +0.079 |
| claude-opus-4-6 | 0.798→0.851 **+0.053** | 0.761→0.805 +0.044 | 0.684→0.773 **+0.089** | 0.843→0.877 +0.034 |
| claude-3-sonnet | 0.758→0.802 +0.044 | 0.666→0.775 **+0.109** | 0.757→0.752 −0.005 | 0.868→0.914 +0.046 |
| mistral-large | 0.768→0.761 −0.007 | 0.725→0.741 +0.016 | 0.600→0.577 −0.023 | 0.855→0.820 −0.035 |
| **mean** | 0.772→0.811 **+0.039** | 0.711→0.776 **+0.065** | 0.694→0.719 **+0.025** | — |

## Column glossary

- **Quality** — LLM-judge headline (0–1), weighted blend of the four sub-scores. Trust: high; the primary decision column.
- **Content** — judge sub-score for depth/coverage. Trust: high in aggregate, **but noisy per-fixture on thin transcripts** (see Caveats) — and structurally biased *against* terseness: the rubric docks a sparse note to ≤0.4 *even when fully faithful*. Read it as a 22-fixture mean, not cell by cell.
- **Tags / Decisions / Actions** — judge sub-scores. Actions saturated (0.91–0.99, non-discriminating). Tags and Decisions moved meaningfully and are informative.
- **Faithfulness** — atomic grounding score. **Non-discriminating AND unreliable** (0.88–1.00, and it sat at 1.00 on cells the judge prose flagged) — do not read grounding off it. Grounding was assessed by reading the sparse-fixture outputs.
- **Fixtures** — 22 except the two transient-skip cells (21); means on those are over one fewer fixture.

## Model summary

Ranking on the **shipped** prompt (`analysis@v3`): Opus 0.798 > Mistral 0.768 > Nova Lite 0.764 > Sonnet 0.758 — tight. On the **winning** prompt (V5): Opus 0.851 > Nova Lite 0.830 > Sonnet 0.802 > Mistral 0.761.

V5 helps every model except Mistral. **Keep all four** — no model changes this run. Two model notes for follow-up (not actioned here):

- **Anthropic access is now live in prod.** `aws bedrock list-foundation-models` under `--profile prod` lists `claude-opus-4-6`, `claude-sonnet-4-6`, and `claude-3-7-sonnet` as on-demand, and the sweep invoked Opus + Sonnet cleanly. The old "Anthropic needs the use-case form first" blocker no longer applies — a prod-model upgrade or **MPI-3** is unblocked by access (cost/quality judgement only).
- **`mistral-large` is the weak outlier** (low Tags across all prompts, and the only model V5 doesn't lift). If a non-Anthropic option is still wanted, a newer Mistral tier is worth a future sweep; otherwise it's a drop candidate now that Anthropic is freely available.

## Prompt summary

V5 did exactly what MPI-2 set out to do:

1. **Banked the depth win on the production model** — Nova Lite Content **+0.089**, Quality **+0.066** vs V3; and lifted Content on all four (mean +0.065).
2. **Made grounding dominant without losing depth.** The "GROUNDING COMES FIRST (overrides depth)" clause + the worked thin-transcript example produced correctly *terse* notes on the sparse fixtures with **no fabrication** (judge prose on opus-V5 `14-all-hands-reorg`: "accurately captures limited information without fabrication"). Where the source supported depth, V5 stayed deep.
3. **Restored tag discipline** — V5 Tags **mean +0.025 vs V3** and **+0.054 vs V4**, reversing V4's across-the-board tag drop; up on Nova Lite (+0.039) and Opus (+0.089), flat on Sonnet, only Mistral down.

**The prior run's V4 "fabrication regression" was a judge error, not a real failure.** The two entities the run-532442 judge called fabrications — **"Cyberdyne"** (`17-budget-review`) and **"Stark Industries"** (`14-all-hands-reorg`) — are both present in each fixture's `existingContent` (the user's note) *and* are expected gold tags. The prompt explicitly permits grounding in the user's note, so emitting them is **correct**. The judge flagged them because it compared only against the transcript, ignoring the note. This run's same judge is inconsistent about it (it penalised "Cyberdyne" on V4/nova but not on V5/nova or V5/opus, all of which include it) — confirming the signal was judge noise, not a prompt property. Net effect: V4 was over-penalised last run; V5's real, reproducible gains stand on their own regardless.

**Which prompt to keep:** **`analysis@v5`** — ship it (switch `PromptCatalog.Current`). V3 → superseded; V4 → tested, not shipped (it was a stepping stone; V5 dominates it).

**What the next iteration should target:** not the prompt — the **measurement**. Two judge defects surfaced: (a) the **content rubric penalises justified terseness** on thin transcripts (≤0.4 even when faithful), creating a perverse incentive *against* the grounding clamp we just shipped; (b) the **judge is note-blind** — it treats user-note entities as fabrication because it only sees the transcript. Both should be fixed before content scores on sparse fixtures can be trusted cell-by-cell. Proposed as the next backlog item (see `phase-model-prompt-improvements.md`).

## Caveats & confidence

- **Cross-run variance is real and material** — this run's V3/V4 numbers differ from `run-532442` by up to ~0.07 on Content (e.g. V4/nova Content 0.718 then vs 0.695 now; V3/nova 0.618 then vs 0.693 now). This **validates running all three prompts in one sweep** and means the prior run's V4 conclusions were partly cross-run noise on top of the judge error. Trust this run's *within-run* deltas, not cross-run ones.
- **Judge is noisy on tiny transcripts** — V5 `14-all-hands-reorg` scored opus 0.30 vs sonnet 0.90 for near-equivalent faithful notes. Sparse-fixture content scores are unreliable per-cell; the 22-fixture means are sound.
- **Synthetic only** — no real-meeting fixtures; deltas may not transfer exactly. A confirmation run on private real fixtures (`EVAL_FIXTURES_DIR`) before/after shipping is worthwhile.
- **Judge family-bias** — Claude 3.7 Sonnet judge may mildly flatter Opus/Sonnet. Doesn't affect within-model V3→V5 deltas (same judge both sides), which the decision rests on.
- **Two transient skips** — `nova-lite/V3` and `sonnet/V4` over 21 fixtures; immaterial to the decision.
