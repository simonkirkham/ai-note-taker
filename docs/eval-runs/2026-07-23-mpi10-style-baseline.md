# 2026-07-23 — MPI-10: a "matches the user's style" judge dimension + baseline

**Decision: ship the `style` dimension (#399); no prompt/model change.** This adds *measurement*, not a new prompt — it establishes the baseline that MPI-9 (`analysis@v9`) must beat. Eval-harness-only; never deployed.

## Why

The 2026-07-23 manual-vs-generated corpus review found the generated notes read as neutral third-party minutes ("The team discussed X") while the user writes dense, subject-first factual bullets. The harness had **no dimension that measured that gap** — tags/actions/decisions/content/faithfulness can all be high on a note that misses the user's style entirely. Without a metric, no MPI-9 claim is provable.

## What changed

- **`FixtureExpected.GoldNote`** — the user's own note for a meeting, verbatim, as the STYLE gold. Optional; the synthetic committed corpus has none, so the dimension is inert there.
- **`style` dimension on the quality judge** — rendered only when a gold note is present. Rewards: subject-first factual bullets (a person/system/number leads, never "The team discussed…"), maximum fact coverage in minimum words with no filler ("longer but terser"), headers + nested bullets, named attribution where the transcript supports it, the user's spelling. Explicitly **does not** penalise the note for omitting the user's private judgement/questions absent from the transcript (those are the user's to add).
- **`Style` wired through** the row, per-case output, and a report column (averaged only over gold-note fixtures → "—" on the synthetic corpus, never a diluting 0).

## Fixtures (real, local-only)

4 of the user's actual meetings, gold = the user's own note, input = transcript only. They live in the git-ignored `eval-fixtures-real/` — **real data, public repo, never committed**. Chosen for a rich transcript *and* a dense own-note to serve as the style gold:

| Fixture (local id) | Transcript chars | Gold-note chars |
| --- | ---: | ---: |
| `real-aggs-api-inception` | 87 605 | 2 333 |
| `real-data-migrations-lessons` | 53 508 | 2 278 |
| `real-delivery-process-qa` | 24 553 | 2 569 |
| `real-chat-steve-white` | 31 947 | 2 097 |

Design choice: `existingContent` is deliberately **empty** so the gold isn't handed to the model as input — this measures whether the *prompt* produces the user's style from the transcript, not whether it echoes a supplied note.

## Result — baseline `analysis@v8` (current), Nova Lite (prod model)

| Quality | Tags | Actions | Decisions | Content | **Style** | Faithfulness |
| --- | --- | --- | --- | --- | --- | --- |
| 0.375 | 0.350 | 0.775 | 0.500 | 0.625 | **0.200** | 1.000 |

**Style is the clear floor (0.20)** — worst dimension by far, confirming the corpus review as a repeatable metric. The dimension discriminates cleanly (style 0.20 vs content 0.63 vs faithfulness 1.0), and the judge's per-note rationales name the exact gap, unprompted:

- *"style is completely opposite to Simon's dense bulleted format"*
- *"uses prose paragraphs instead of Simon's bullet style… lacks the density and directness"*
- *"over-formalizes decisions that weren't clearly made… doesn't match Simon's terse fact-first approach"*
- *"completely misses Simon's bullet-heavy note style"*

## What this sets up

MPI-9 (`analysis@v9`) is measured against exactly this harness: the target is **style climbing from 0.20** with **faithfulness held at 1.0** as the guardrail (no invention, no padding — both penalised on the style axis too). Re-run with `EVAL_FIXTURES_DIR=eval-fixtures-real EVAL_PROMPT_VERSIONS=analysis@v8,analysis@v9 AWS_PROFILE=prod make eval`.

## Caveats

- Real-corpus fixtures are **local-only** (never in CI). The style dimension is exercised in CI solely by the prompt unit tests; the live scores require the user's AWS profile + local fixtures.
- The `overall` Quality weights fact-coverage on both `content` and `style` when a gold note is present (density *is* the user's style), so headline Quality on the real corpus is not strictly comparable to the synthetic corpus. Track the **`style`** column for MPI-9, not `overall`.
