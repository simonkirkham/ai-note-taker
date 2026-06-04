# Eval test matrix

The canonical, versioned set of **models** and **prompts** the analysis eval should sweep. Maintained by the [`eval-run`](../../.claude/skills/eval-run/SKILL.md) skill — bump the version and append a changelog line after every run. Rows are never deleted; cut ones are marked `dropped`/`retired` with a reason so the history of what was tried survives.

**Version:** 1 · updated 2026-06-04 · reflects `run-468475` ([report](2026-06-04-frontier-v2-v3.md))

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

> **This table drives the sweep.** `EVAL_PRESET=keep make eval` reads the model id from every `**keep**` row above and runs exactly those — edit a row's status and the next run follows, so the recommendation and the actual sweep can't drift. The `frontier` preset still lists all candidates (incl. dropped ones) for a one-off full cross-vendor comparison.

## Prompts under test

| Prompt | Status | Notes |
| --- | --- | --- |
| `analysis@v1` | retired | Original. |
| `analysis@v2` | superseded | Beaten by v3 on the strong models. |
| `analysis@v3` | **current best — shipping (10-O)** | Lifts Opus (+0.06), fixed Opus tags (0.51→0.71). |
| `analysis@v4` | planned (MPI-1) | Target the universal weak dimension: **Content** depth. |

## Judge

- Quality judge: `anthropic.claude-3-7-sonnet-20250219-v1:0` (neutral, held out of candidates). Confirm any Anthropic-candidate lead with a non-Anthropic judge before treating it as settled.

## Changelog

- **v1** (2026-06-04, `run-468475`): initial matrix from the frontier `analysis@v2`-vs-`v3` sweep. Kept Opus 4.6 / Claude 3 Sonnet / Mistral Large / Nova Lite; dropped Nova Pro (beaten by cheaper Nova Lite) and Llama 3 70B (weakest). `v3 > v2` → shipping via 10-O; `v4` planned for content depth (10-P).
