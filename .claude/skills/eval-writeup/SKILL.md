---
name: eval-writeup
description: Turn an analysis-eval run (Results/*.jsonl + report.md) into a written decision report — column glossary, model ranking with which to keep testing, and prompt comparison with which to keep / what to try next. Run after `make eval`. Triggers include "write up the eval results", "eval report", "summarise the model/prompt comparison".
---

# Eval write-up

Turn a `make eval` run into a written analysis so the numbers become decisions. Every section ends with a recommendation, not just data.

## Inputs

- `tests/Analysis.Eval/bin/Debug/net10.0/Results/<runId>.jsonl` — one row per fixture × prompt × model (every score).
- `tests/Analysis.Eval/bin/Debug/net10.0/Results/report.md` — the aggregated table. If missing, render it (no re-run):
  `RUN_BEDROCK_EVAL=1 dotnet test tests/Analysis.Eval/Analysis.Eval.csproj --no-build --filter "Category=Report"`

First inspect the `fixtureId`s:
- **named** (`NN-short-description`) → **synthetic** corpus: gold labels exist, so Tag/Action/Content **F1** are valid alongside Quality.
- **GUID-like** → **real meetings**: only **Quality** and **Faithfulness** are meaningful (no gold labels). Treat as private.

## Output

Write `docs/eval-runs/<YYYY-MM-DD>-<slug>.md`.

> **Never paste transcript or meeting content** — the repo is public and real fixtures are private. Aggregate scores, model names, and prompt versions only.

## Sections

1. **Run metadata** — date; fixtures (count + synthetic/real); prompts compared; models swept; the Quality judge model; and caveats (e.g. uneven completed-fixture counts from throttling skips).
2. **Results** — paste `report.md` (best-Quality-first).
3. **Column glossary** — for every column: what it measures, how much to trust it, and its weight in a decision. Explicitly flag **saturated / non-discriminating** columns (e.g. Faithfulness clustered near 1.0 = no signal) and **caveat** columns (Fixtures count → fewer = less reliable, not strictly comparable).
4. **Model summary** — rank by Quality; per-model strengths/weaknesses by dimension; name the universal weak dimension; then **which models to keep testing and which to drop**, weighing cost vs quality.
5. **Prompt summary** — compare versions per model and overall; quantify which dimensions each prompt moved (e.g. "V3 lifted Opus +0.06, fixed its tags 0.51→0.71"); then **which prompt to keep** and **what the next prompt iteration should target** (usually the weakest dimension).
6. **Caveats & confidence** — uneven fixture counts; **judge family-bias** (a same-vendor judge inflates that vendor — recommend a held-out non-vendor judge re-run to confirm any vendor's lead); sample size; synthetic vs real.

## Maintain the test matrix (every run)

After writing the report, update **`docs/eval-runs/test-matrix.md`** — the versioned source of truth for which models and prompts are under test. This keeps the next sweep focused on what's worth testing.

- **Bump the version** (integer) and set the date + the `runId` it reflects.
- **Apply this run's decisions:** mark dropped models `dropped (<date>)` with a one-line reason; keep the survivors; add any newly-introduced models/prompts; mark the current production prompt and any planned next prompt.
- **Append a changelog line:** `vN (<date>, <runId>): <what changed and why>`.
- **Keep the presets in sync:** the `keep` model set should match the `frontier`/`core` presets in `scripts/run-eval.sh`; if they've diverged, note it (or update the preset in the same change).
- Never delete rows — mark them `retired`/`dropped` so the history of what was tried (and why it was cut) survives.

If `docs/eval-runs/test-matrix.md` doesn't exist yet, create it: a short intro, a **Models under test** table (`Model | Status | Notes`), a **Prompts under test** table (`Prompt | Status | Notes`), and a **Changelog**.

## Rules

- Lead with the decision. Rank and recommend on the **trustworthy** columns (Quality + its sub-scores); say so when a column is non-discriminating.
- **Quantify** deltas — "+0.06", "0.51→0.71" — never just "better".
- Keep model/prompt recommendations concrete and actionable (keep / drop / verify-then-decide; and the specific next prompt target).
- No meeting content, ever.
