# Eval test matrix

The canonical, versioned set of **models** and **prompts** the analysis eval should sweep. Maintained by the [`eval-run`](../../.claude/skills/eval-run/SKILL.md) skill — bump the version and append a changelog line after every run. Rows are never deleted; cut ones are marked `dropped`/`retired` with a reason so the history of what was tried survives.

**Version:** 3 · updated 2026-06-04 · reflects `run-551897` ([report](2026-06-04-v3-v4-v5-grounding.md))

## Models under test

| Model | Status | Notes |
| --- | --- | --- |
| `anthropic.claude-opus-4-6-v1` | **keep** | Quality ceiling (0.80). Expensive. |
| `anthropic.claude-3-sonnet-20240229-v1:0` | **keep** | Value pick — near-Opus, cheaper. |
| `mistral.mistral-large-2402-v1:0` | **keep** | Best non-Anthropic; no Claude-access dependency. |
| `amazon.nova-lite-v1:0` | **keep** | Cheap baseline that competes with the frontier. |
| `amazon.nova-pro-v1:0` | dropped (2026-06-04) | Loses to the cheaper Nova Lite on quality. |
| `meta.llama3-70b-instruct-v1:0` | dropped (2026-06-04) | Consistently weakest (content 0.54). |
| `amazon.nova-micro-v1:0` | not tested | Weakest Amazon tier; excluded from frontier. |
| `anthropic.claude-sonnet-4-6` | candidate (MPI-3) | Current-gen Sonnet; flagged to replace the aged 2024 value pick. Confirm on-demand access in eu-west-2 first. |

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

## Changelog

- **v1** (2026-06-04, `run-468475`): initial matrix from the frontier `analysis@v2`-vs-`v3` sweep. Kept Opus 4.6 / Claude 3 Sonnet / Mistral Large / Nova Lite; dropped Nova Pro (beaten by cheaper Nova Lite) and Llama 3 70B (weakest). `v3 > v2` → shipping via 10-O; `v4` planned for content depth (10-P).
- **v2** (2026-06-04, `run-532442`): `analysis@v3`-vs-`v4` on the keep-set (clean run, all 22 fixtures per cell). `v4` lifted Content on the weaker models (Nova Lite **+0.10**, Sonnet +0.05) but regressed the strong ones (Mistral −0.05 Quality), dropped Tags on all four, and **worsened fabrication on thin transcripts** — so `v4` is **not shipped**; `v3` stays current. `v5` planned to keep the depth win and fix grounding. Model set unchanged; **`anthropic.claude-sonnet-4-6`** flagged as a candidate to replace the aged `claude-3-sonnet-20240229` in a future model sweep.
- **v3** (2026-06-04, `run-551897`): `analysis@v3`-vs-`v4`-vs-`v5` on the keep-set, all three in one sweep. **`v5` wins and ships** — prod (Nova Lite) Quality +0.066 / Content +0.089 vs v3, Tags restored (+0.025 vs v3), and **no fabrication**. Notably, v2's "v4 fabrication regression" was found to be a **judge error**: the flagged entities ("Cyberdyne"/"Stark Industries") are in the fixtures' user-note and gold tags, so emitting them is correct — the judge ignored the note. Model set unchanged. **Anthropic access confirmed live in prod** (Opus/Sonnet-4-6 invocable on-demand), unblocking MPI-3. Next item targets the **judge/rubric** (terseness penalty + note-blindness), not the prompt.
