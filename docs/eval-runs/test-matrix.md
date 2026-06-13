# Eval test matrix

The canonical, versioned set of **models** and **prompts** the analysis eval should sweep. Maintained by the [`eval-run`](../../.claude/skills/eval-run/SKILL.md) skill — bump the version and append a changelog line after every run. Rows are never deleted; cut ones are marked `dropped`/`retired` with a reason so the history of what was tried survives.

**Version:** 6 · updated 2026-06-13 · reflects `run-286900` ([report](2026-06-13-mpi6-tags-v6.md))

## Models under test

| Model | Status | Notes |
| --- | --- | --- |
| `anthropic.claude-sonnet-4-6` | **keep** | New value pick (MPI-3, `run-28225`): top model on `analysis@v5` (Quality 0.850), beats the 2024 Sonnet +0.030 and Opus +0.039 at lower cost. |
| `anthropic.claude-opus-4-6-v1` | **keep** | Quality ceiling reference. Expensive; now beaten by Sonnet-4-6. |
| `mistral.mistral-large-2402-v1:0` | **keep** | Only non-Anthropic; weak-tags outlier (0.591) — future drop candidate. |
| `amazon.nova-lite-v1:0` | **keep** | Cheap production baseline; now −0.036 behind Sonnet-4-6 (prod-upgrade candidate). |
| `anthropic.claude-3-sonnet-20240229-v1:0` | dropped (2026-06-10) | Aged value pick; beaten by same-vendor `claude-sonnet-4-6` on Quality (0.820 vs 0.850), `run-28225`. |
| `amazon.nova-pro-v1:0` | dropped (2026-06-04) | Loses to the cheaper Nova Lite on quality. |
| `meta.llama3-70b-instruct-v1:0` | dropped (2026-06-04) | Consistently weakest (content 0.54). |
| `amazon.nova-micro-v1:0` | not tested | Weakest Amazon tier; excluded from frontier. |

> **This table drives the sweep.** `EVAL_PRESET=keep make eval` reads the model id from every `**keep**` row above and runs exactly those — edit a row's status and the next run follows, so the recommendation and the actual sweep can't drift. The `frontier` preset still lists all candidates (incl. dropped ones) for a one-off full cross-vendor comparison.
>
> ⚠️ **Changelog prose must never contain the bold keep status token** (the two-asterisk \*\*keep\*\* marker used in the status cells above). The keep extraction in `scripts/run-eval.sh` fixed-string-greps for that marker across the whole file, then pulls every provider-dot-model-shaped token off the matched lines — so a changelog sentence carrying both that marker and any dotted token (even an `e.g.`) leaks a phantom model id into the sweep. In prose, refer to keep rows as "keep-set" / "keep row" without the asterisks.

## Prompts under test

| Prompt | Status | Notes |
| --- | --- | --- |
| `analysis@v1` | retired | Original. |
| `analysis@v2` | superseded | Beaten by v3 on the strong models. |
| `analysis@v3` | superseded by v5 (`run-551897`) | Was current best; lifted Opus (+0.06), fixed Opus tags (0.51→0.71). Beaten by v5 on prod (+0.066 Quality) and overall. |
| `analysis@v4` | tested, not shipped (`run-532442`, `run-551897`) | Depth attempt; its "fabrication regression" was a **judge error** (user-note entities mis-flagged), and it dropped Tags. A stepping stone — v5 dominates it. |
| `analysis@v5` | superseded by v6 (`run-286900`) | V4's depth + a grounding-dominant clamp + restored tags. Was current; beaten by v6 on tags + overall Quality on every model. |
| `analysis@v6` | **shipping (MPI-6, `run-286900`)** | v5 with only the tag rule tightened (aim 2–3, ≤5, high-signal, retrieval rationale). Tags +0.125 mean (+0.05 to +0.20 per model); overall Quality +0.028 mean; no regression. |

## Judge

- Quality judge: `anthropic.claude-3-7-sonnet-20250219-v1:0` (neutral, held out of candidates). Confirm any Anthropic-candidate lead with a non-Anthropic judge before treating it as settled.
- **MPI-4 (`run-28225`):** rubric reworded so the user's existing note is valid grounding (not fabrication) and so thinness is judged relative to the source (a faithful-terse note on a thin transcript is no longer auto-capped at ≤0.4). The terseness fix works; the note-grounding fix was only partial at the prompt level.
- **MPI-5 (`run-78385`, #257) — note-grounding now fixed:** the judge receives the fixture's gold tags (humanised) as a deterministic `GROUNDED ENTITIES — never flag as fabrication` allowlist. Closed the note-blindness prompt wording couldn't: `14-all-hands-reorg` content **0.20 → 0.70–0.90** across all keep models, now consistent with faithfulness (1.00). Sparse-fixture content scores are trustworthy per-cell again.

## Changelog

- **v1** (2026-06-04, `run-468475`): initial matrix from the frontier `analysis@v2`-vs-`v3` sweep. Kept Opus 4.6 / Claude 3 Sonnet / Mistral Large / Nova Lite; dropped Nova Pro (beaten by cheaper Nova Lite) and Llama 3 70B (weakest). `v3 > v2` → shipping via 10-O; `v4` planned for content depth (10-P).
- **v2** (2026-06-04, `run-532442`): `analysis@v3`-vs-`v4` on the keep-set (clean run, all 22 fixtures per cell). `v4` lifted Content on the weaker models (Nova Lite **+0.10**, Sonnet +0.05) but regressed the strong ones (Mistral −0.05 Quality), dropped Tags on all four, and **worsened fabrication on thin transcripts** — so `v4` is **not shipped**; `v3` stays current. `v5` planned to keep the depth win and fix grounding. Model set unchanged; **`anthropic.claude-sonnet-4-6`** flagged as a candidate to replace the aged `claude-3-sonnet-20240229` in a future model sweep.
- **v3** (2026-06-04, `run-551897`): `analysis@v3`-vs-`v4`-vs-`v5` on the keep-set, all three in one sweep. **`v5` wins and ships** — prod (Nova Lite) Quality +0.066 / Content +0.089 vs v3, Tags restored (+0.025 vs v3), and **no fabrication**. Notably, v2's "v4 fabrication regression" was found to be a **judge error**: the flagged entities ("Cyberdyne"/"Stark Industries") are in the fixtures' user-note and gold tags, so emitting them is correct — the judge ignored the note. Model set unchanged. **Anthropic access confirmed live in prod** (Opus/Sonnet-4-6 invocable on-demand), unblocking MPI-3. Next item targets the **judge/rubric** (terseness penalty + note-blindness), not the prompt.
- **v6** (2026-06-13, `run-286900`): MPI-6 tag-discipline prompt. `analysis@v6` (v5 + a tightened tag rule only) **wins and ships** — tags up on every keep model (+0.05 to +0.20, mean +0.125) and overall Quality up on every model (mean +0.028), with no regression. `analysis@v5` superseded; `Current` → v6. Tags is no longer the universal weak dimension — only Mistral stays sub-0.75 (0.689), strengthening it as a drop candidate. Model set unchanged.
- **v5** (2026-06-13, `run-78385`): MPI-5 judge fix confirmation — `analysis@v5` on the keep-set with the programmatic grounded-entity allowlist (#257). Sparse-fixture note-blindness closed: `14-all-hands-reorg` content `0.20 → 0.70–0.90` across all four keep models, now consistent with faithfulness (1.00). No model or prompt change (keep-set and `analysis@v5` unchanged). Quality ranking this run: Opus 0.875 > Sonnet 0.862 > Nova Lite 0.850 > Mistral 0.805; Tags (0.527–0.720) is now the lone sub-0.75 dimension on every model, with Mistral the weak-tags outlier — next lever. MPI-5 marked Done.
- **v4** (2026-06-10, `run-28225`): MPI-3 model sweep on `analysis@v5` + MPI-4 judge fix. **`claude-sonnet-4-6` added as a keep-set row and is the new value pick** — top model (Quality 0.850), beats the aged `claude-3-sonnet-20240229` (0.820, now **dropped**) and Opus (0.811). Judge ran the MPI-4-fixed rubric: terseness auto-fail removed (sparse-fixture content rose — `17-budget-review` to 0.90), but **note-blindness only partially fixed** — `14-all-hands-reorg`'s note-grounded "Stark Industries" still mis-flagged as fabrication (content 0.20). Programmatic note-grounding proposed as MPI-5. Sonnet-4-6 also leads prod Nova Lite (+0.036) — prod-upgrade candidate, not actioned.
