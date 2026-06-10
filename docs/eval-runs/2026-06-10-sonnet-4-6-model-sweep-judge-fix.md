# Eval run — 2026-06-10: `claude-sonnet-4-6` model sweep + MPI-4 judge fix

_Produced by the `eval-run` skill from `run-28225`._

## TL;DR — decisions

1. **MPI-3 — swap the value pick: keep `claude-sonnet-4-6`, drop `claude-3-sonnet-20240229`.** On the shipped prompt (`analysis@v5`) the current-gen Sonnet is the **top model overall** (Quality **0.850**), beating the aged 2024 Sonnet by **+0.030** and Opus by **+0.039** — at a fraction of Opus's cost. The 2024 Sonnet still scores well (0.820) but is strictly dominated by its same-vendor successor, so it retires.
2. **MPI-4 — judge fix is a real improvement but only partial.** The terseness auto-fail is gone (fixture `17-budget-review` content jumped to 0.80–0.90 on three models). But the **note-blindness persists**: on `14-all-hands-reorg` the judge still flags "Stark Industries" — which is in the user's note and a gold tag — as fabrication and sinks content to 0.20, *despite the new prompt naming the note as valid grounding*. The prompt edit is necessary but insufficient; a programmatic grounding fix is the follow-up (see Prompt/judge summary).
3. **Prod-model note:** `claude-sonnet-4-6` (0.850) now leads Nova Lite (0.814) by +0.036. A prod upgrade to Sonnet-4-6 is worth a cost/latency review — recorded as a follow-up, not actioned here.

## Run metadata

- **Date:** 2026-06-10 · **runId:** `run-28225`
- **Fixtures:** 22, **synthetic** (built-in corpus, gold labels present — all metrics valid).
- **Prompt:** `analysis@v5` only (the shipped prompt). Model-only sweep — pinned via the new `EVAL_PROMPT_VERSIONS=analysis@v5` override so the matrix didn't re-run V3/V4.
- **Models:** keep-set + the MPI-3 candidate — `anthropic.claude-sonnet-4-6` (candidate), `anthropic.claude-3-sonnet-20240229-v1:0` (incumbent value pick), `amazon.nova-lite-v1:0` (**production**), `anthropic.claude-opus-4-6-v1`, `mistral.mistral-large-2402-v1:0`.
- **Quality judge:** `anthropic.claude-3-7-sonnet-20250219-v1:0` (held out of candidates) — **running the MPI-4-fixed rubric** (note-grounding clause + terseness-relative-to-source).
- **Completeness:** 110/110 cells, **zero skips**. `claude-sonnet-4-6` invoked cleanly on-demand in eu-west-2 — MPI-3 is not access-blocked.

## Results (best-Quality-first)

| Prompt | Model | Quality | Tags | Actions | Decisions | Content | Faithfulness | Fixtures |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| analysis@v5 | **claude-sonnet-4-6** | **0.850** | 0.741 | 0.982 | 0.855 | 0.843 | 0.982 | 22 |
| analysis@v5 | claude-3-sonnet-20240229 | 0.820 | 0.736 | 0.859 | 0.923 | 0.848 | 0.959 | 22 |
| analysis@v5 | nova-lite **(prod)** | 0.814 | 0.655 | 0.973 | 0.909 | 0.791 | 0.929 | 22 |
| analysis@v5 | claude-opus-4-6 | 0.811 | 0.659 | 0.982 | 0.864 | 0.793 | 0.962 | 22 |
| analysis@v5 | mistral-large | 0.795 | 0.591 | 0.986 | 0.777 | 0.841 | 0.982 | 22 |

Run means: Quality 0.818 · Content 0.823 · Tags 0.676 · Faithfulness 0.963.

## Column glossary

- **Quality** — LLM-judge headline (0–1), holistic blend of the four sub-scores. Trust: high; the primary decision column for MPI-3.
- **Content** — judge sub-score for depth/coverage. Trust: **improved this run** — the MPI-4 terseness fix removed the structural floor that previously capped faithful-terse notes at ≤0.4. Still **noisy per-cell on the two sparse fixtures** (see Caveats), so read it as a 22-fixture mean.
- **Tags** — judge sub-score; the universal weak dimension (run mean 0.676). Mistral is the low outlier (0.591); Sonnet-4-6 and the 2024 Sonnet lead (~0.74). Informative.
- **Actions** — saturated (0.86–0.99); non-discriminating except that the 2024 Sonnet dipped to 0.859.
- **Decisions** — moved meaningfully (0.78–0.92); informative. The 2024 Sonnet leads here (0.923).
- **Faithfulness** — atomic grounding score. **Near-saturated (0.93–0.98) and not the grounding oracle** — it sat at 1.00 on cells the quality judge's prose called fabrication. Grounding was assessed by reading the sparse-fixture rationales.
- **Fixtures** — 22 for every cell (clean run).

## Model summary

Ranking on `analysis@v5`: **Sonnet-4-6 0.850 > 2024-Sonnet 0.820 > Nova Lite 0.814 > Opus 0.811 > Mistral 0.795.**

| Model | Quality | Strength | Weakness |
| --- | --- | --- | --- |
| **claude-sonnet-4-6** | **0.850** | Top Quality + top Content (0.843); balanced across dimensions | Tags 0.741 (good, not best) |
| claude-3-sonnet-20240229 | 0.820 | Best Content (0.848) + best Decisions (0.923) | Weak Actions (0.859) — leaked others' actions on a fixture |
| nova-lite **(prod)** | 0.814 | Cheap; strong Decisions (0.909) | Weak Tags (0.655) |
| claude-opus-4-6 | 0.811 | High Actions (0.982) | Expensive; mid Content/Tags; harshest sparse-fixture self-penalty |
| mistral-large | 0.795 | Strong Content (0.841) this run | Weakest Tags (0.591) — the persistent Mistral failing |

**Universal weak dimension:** **Tags** (run mean 0.676) — every model under-performs here relative to Quality; Mistral worst.

**Keep / drop:**
- **Add `claude-sonnet-4-6` as `**keep**`** — it is the new top model.
- **Drop `claude-3-sonnet-20240229`** — same vendor, beaten by its successor on Quality (−0.030) with no dimension where it is decisively better that matters (its Content/Decisions edge is within judge noise). Marking it `dropped` closes MPI-3.
- **Keep** Nova Lite (prod baseline), Opus (ceiling reference), Mistral (only non-Anthropic; weak-tags outlier and a future drop candidate, but kept this run).

## Prompt / judge summary

Only one prompt ran (`analysis@v5`), so this is a **judge** comparison, not a prompt one. The judge ran the **MPI-4-fixed rubric**.

**What MPI-4 fixed (confirmed):**
- **Terseness penalty removed.** `17-budget-review` content rose to **0.90** (sonnet-4-6, 2024-sonnet) and **0.80** (mistral) — faithful-but-terse notes on a thin transcript are no longer auto-capped at ≤0.4. Run-mean Content (0.823) is the highest recorded.

**What MPI-4 did NOT fix (the honest finding):**
- **Note-blindness persists despite the prompt edit.** On `14-all-hands-reorg`, "Stark Industries" is in the user's note (`existingContent`) and is a gold tag — using it is correct grounding. The new prompt explicitly says the note is "valid grounding, not fabrication", yet the judge still flagged it as fabrication and sank content to **0.20** on opus/sonnet-4-6 and **0.30–0.40** on nova/2024-sonnet (faithfulness was 1.00 on the same cells). Opus's rationale even *acknowledges* the entity is in the note title, then penalises anyway.
- **Inconsistent across the two sparse fixtures:** the same "entity-only-in-note" pattern improved on `17` (Cyberdyne, content 0.80–0.90 on 3 models) but not on `14` (Stark, 0.20–0.50). The judge applies the grounding clause unreliably.

**Conclusion on the judge:** the prompt-level grounding instruction is **necessary but insufficient** — the LLM judge does not reliably honour "the note is grounding" when an entity appears *only* in the note and recurs through the output. The robust fix is **programmatic**, not more prompt wording: e.g. extract note/gold entities and exclude them from the fabrication check, or add a held-out non-vendor judge to confirm sparse-fixture content. Proposed as the MPI-4 follow-up (`MPI-5`) below.

**Next iteration target:** the **measurement** (programmatic note-grounding for the judge) and **Tags** (the universal weak dimension) — not the prompt.

## Caveats & confidence

- **Judge changed this run** — these numbers were produced by the MPI-4-fixed judge, so they are **not directly comparable** to `run-551897`'s v5 cells (which used the old judge). The **within-run model ranking** (Sonnet-4-6 > 2024-Sonnet > …) is the valid MPI-3 signal and is judge-invariant (all models scored by the same judge). Cross-run Content deltas conflate the judge fix with everything else — do not read them as model/prompt movement.
- **Judge family-bias** — the Claude 3.7 judge may mildly flatter the three Anthropic candidates (Sonnet-4-6, 2024-Sonnet, Opus). Sonnet-4-6's +0.030 lead over the 2024 Sonnet is *within* the same vendor so bias cancels; its lead over Nova Lite (+0.036) and Mistral (+0.055) is **not** held-out — confirm with a non-Anthropic judge before any prod-model swap to Sonnet-4-6.
- **Sparse-fixture content still noisy per-cell** (see above) — the `14`/`17` cells swing 0.20↔0.90 for near-equivalent faithful notes. The 22-fixture means are sound; individual sparse cells are not.
- **Synthetic only** — no real-meeting fixtures this run. Confirm a prod-model change on private real fixtures (`EVAL_FIXTURES_DIR`) before shipping.
