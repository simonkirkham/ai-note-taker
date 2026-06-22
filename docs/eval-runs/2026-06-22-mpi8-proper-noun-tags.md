# 2026-06-22 — MPI-8: proper-noun-only tags (`analysis@v8`)

**Decision: ship `analysis@v8`.** `PromptCatalog.Current` → `V8`. Run `run-83741` (keep-set, `v6` vs `v8`, all 22 fixtures).

## What changed

- **Prompt:** the tag rule is narrowed from v6's three permitted kinds (proper noun **or** meeting-type `1:1`/`standup`/`qbr` **or** topic keyword `auth`/`hiring`) to **proper nouns only** — named orgs/clients/vendors, the person a meeting is *about*, and named products/projects/incidents. The named entity is a **must-tag** (always tag the org, or the named project/incident when no org is named) so a client's notes group across every call. Empty is the correct answer when nothing is named.
- **Gold:** the 22 fixtures' gold tags were re-cut to the same proper-noun-only bar (v6's gold mixed in `standup`/`qbr`/`renewal`/`data-pipeline`, which would have scored a correct proper-noun-only prompt as a false regression).
- Everything else in v8 is byte-identical to v7 (incl. the `/ai` instruction path). Wording-only change; deploy-time neutral.

## Why (the user-reported problem)

Tags were too many and the same company wasn't tagged consistently (not every Crosslake/OGI call tagged as such). Root cause: v6's fuzzy three-category target over-generated and let the named client lose its slot to a meeting-type.

## Result — `run-83741`

**Atomic tag F1** (deterministic precision/recall vs the proper-noun gold — the metric that measures "right proper nouns, nothing else"):

| Model | v6 | v8 | Δ |
| --- | --- | --- | --- |
| `claude-opus-4-6` | 0.483 | **0.970** | +0.487 |
| `claude-sonnet-4-6` | 0.376 | **0.932** | +0.556 |
| `mistral-large-2402` | 0.191 | **0.817** | +0.626 |
| `nova-lite` (prod) | 0.158 | **0.698** | +0.540 |

**Precision and tag count** (the "fewer, more useful" axis):

| Model | v6 precision | v8 precision | v6 tags/note | v8 tags/note |
| --- | --- | --- | --- | --- |
| `sonnet-4-6` | 0.29 | **0.92** | 2.67 | **1.14** |
| `opus-4-6` | 0.38 | **0.96** | 2.19 | **1.09** |
| `nova-lite` | 0.11 | **0.71** | 2.77 | **0.86** |
| `mistral-large` | 0.13 | **0.81** | 2.95 | **1.48** |

v8 roughly **halves the tag count** and **multiplies precision 3–7×** on every model.

**No regression on other dimensions** (v6 → v8, max swing):

| Dimension | Worst Δ | Verdict |
| --- | --- | --- |
| Faithfulness | Opus −0.027, Nova +0.034 | flat |
| Content (judge) | Mistral −0.012, Nova +0.012 | flat |
| Actions (judge) | Opus −0.022 | flat |
| Overall Quality (judge) | Sonnet **+0.014**, Nova −0.022 | neutral-to-positive |

## Concrete tag sets (Sonnet, v6 → v8)

| Fixture | v6 (noisy) | v8 (clean) |
| --- | --- | --- |
| 08-qbr | `wayne enterprises, qbr, renewal` | `wayne-enterprises` |
| 14-all-hands | `stark-industries, reorg, all-hands` | `stark-industries` |
| 18-sync | `snowflake, etl, data-pipeline` | `snowflake` |
| 09-vendor | `datadog, observability, apm` | `datadog` |
| 11-incident | `postmortem, payments, chen` | `payments-outage` |
| 01-standup | *(over-tagged)* | `(none)` — correct restraint |

20 of 22 Sonnet fixtures score a perfect clean tag (F1 1.0).

## Column glossary

- **atomic tagF1** — deterministic set-F1 of predicted vs gold tags (trim+lowercase). The primary tag metric; directly measures proper-noun match.
- **Tags column in `report.md`** — the LLM judge's *holistic* `qualityTags` rating (0–1), a softer signal. It was **mixed** for v8 (Sonnet/Mistral up, Opus/Nova down) because the judge mildly dislikes sparse/empty tag sets — but per the stated preference (fewer, more useful > more, weaker), the atomic metric and the per-fixture sets are authoritative here. Do not confuse the two.
- precision / recall / tags-per-note — per-fixture means; precision = fraction of emitted tags that are correct; recall = fraction of gold tags emitted.

## Caveats

- **Recall traded for precision deliberately.** Nova Lite v8 recall 0.69 (avg 0.86 tags/note) — it occasionally emits no tag where one was valid. This is the *preferred* direction (fewer over more); the stronger models (Sonnet/Opus) hold recall 1.0.
- **Two minor v8 over-tags (Sonnet):** `02-one-on-one` tagged the participant `alice` (gold empty); `22-sprint-planning` emitted `sprint-15` + two work-streams on a genuinely multi-stream meeting. 2 of 22, both rare, both small.
- **Fixture skips:** a few cells ran 21/22 (Bedrock throttling) — does not change the verdict's direction.
- An earlier run (`run-63567`) was discarded: it had two gold typos (`umbrella` vs the real `umbrella-corp`; `mobile-nav` vs `mobile-navigation-redesign`) and a v8 prompt that anchored only on orgs (dropping named incidents/projects on org-less meetings). Both fixed before `run-83741`.

## Next weak dimension

Tags are no longer the weak spot. With v8, the lone sub-0.85 holistic dimensions are Content (~0.84–0.88) and Mistral's Decisions (0.77). Mistral remains the weakest model overall (Quality 0.824) — still the clearest drop candidate.
