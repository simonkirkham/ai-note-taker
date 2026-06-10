# Eval test matrix

The canonical, versioned set of **models** and **prompts** the analysis eval should sweep. Maintained by the [`eval-run`](../../.claude/skills/eval-run/SKILL.md) skill — bump the version and append a changelog line after every run. Rows are never deleted; cut ones are marked `dropped`/`retired` with a reason so the history of what was tried survives.

**Version:** 4 · updated 2026-06-10 · reflects `run-28225` ([report](2026-06-10-sonnet-4-6-model-sweep-judge-fix.md))

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

## Prompts under test

| Prompt | Status | Notes |
| --- | --- | --- |
| `analysis@v1` | retired | Original. |
| `analysis@v2` | superseded | Beaten by v3 on the strong models. |
| `analysis@v3` | superseded by v5 (`run-551897`) | Was current best; lifted Opus (+0.06), fixed Opus tags (0.51→0.71). Beaten by v5 on prod (+0.066 Quality) and overall. |
| `analysis@v4` | tested, not shipped (`run-532442`, `run-551897`) | Depth attempt; its "fabrication regression" was a **judge error** (user-note entities mis-flagged), and it dropped Tags. A stepping stone — v5 dominates it. |
| `analysis@v5` | **shipping (MPI-2, `run-551897`)** | V4's depth + a grounding-dominant clamp + restored tags. Prod (Nova Lite) Quality +0.066 / Content +0.089 vs v3; Tags restored (+0.025 vs v3); no fabrication. |

## Judge

- Quality judge: `anthropic.claude-3-7-sonnet-20250219-v1:0` (neutral, held out of candidates). Confirm any Anthropic-candidate lead with a non-Anthropic judge before treating it as settled.
- **MPI-4 (`run-28225`):** rubric reworded so the user's existing note is valid grounding (not fabrication) and so thinness is judged relative to the source (a faithful-terse note on a thin transcript is no longer auto-capped at ≤0.4). The terseness fix works; the note-grounding fix is only partial at the prompt level — see MPI-5 follow-up.

## Changelog

- **v1** (2026-06-04, `run-468475`): initial matrix from the frontier `analysis@v2`-vs-`v3` sweep. Kept Opus 4.6 / Claude 3 Sonnet / Mistral Large / Nova Lite; dropped Nova Pro (beaten by cheaper Nova Lite) and Llama 3 70B (weakest). `v3 > v2` → shipping via 10-O; `v4` planned for content depth (10-P).
- **v2** (2026-06-04, `run-532442`): `analysis@v3`-vs-`v4` on the keep-set (clean run, all 22 fixtures per cell). `v4` lifted Content on the weaker models (Nova Lite **+0.10**, Sonnet +0.05) but regressed the strong ones (Mistral −0.05 Quality), dropped Tags on all four, and **worsened fabrication on thin transcripts** — so `v4` is **not shipped**; `v3` stays current. `v5` planned to keep the depth win and fix grounding. Model set unchanged; **`anthropic.claude-sonnet-4-6`** flagged as a candidate to replace the aged `claude-3-sonnet-20240229` in a future model sweep.
- **v3** (2026-06-04, `run-551897`): `analysis@v3`-vs-`v4`-vs-`v5` on the keep-set, all three in one sweep. **`v5` wins and ships** — prod (Nova Lite) Quality +0.066 / Content +0.089 vs v3, Tags restored (+0.025 vs v3), and **no fabrication**. Notably, v2's "v4 fabrication regression" was found to be a **judge error**: the flagged entities ("Cyberdyne"/"Stark Industries") are in the fixtures' user-note and gold tags, so emitting them is correct — the judge ignored the note. Model set unchanged. **Anthropic access confirmed live in prod** (Opus/Sonnet-4-6 invocable on-demand), unblocking MPI-3. Next item targets the **judge/rubric** (terseness penalty + note-blindness), not the prompt.
- **v4** (2026-06-10, `run-28225`): MPI-3 model sweep on `analysis@v5` + MPI-4 judge fix. **`claude-sonnet-4-6` added as `**keep**` and is the new value pick** — top model (Quality 0.850), beats the aged `claude-3-sonnet-20240229` (0.820, now **dropped**) and Opus (0.811). Judge ran the MPI-4-fixed rubric: terseness auto-fail removed (sparse-fixture content rose, e.g. `17-budget-review` to 0.90), but **note-blindness only partially fixed** — `14-all-hands-reorg`'s note-grounded "Stark Industries" still mis-flagged as fabrication (content 0.20). Programmatic note-grounding proposed as MPI-5. Sonnet-4-6 also leads prod Nova Lite (+0.036) — prod-upgrade candidate, not actioned.
