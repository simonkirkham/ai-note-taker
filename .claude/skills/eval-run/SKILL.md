---
name: eval-run
description: Run and write up an analysis eval end to end — review the test matrix, check for new model versions and suggest what to add, run `make eval`, then turn the run (Results/*.jsonl + report.md) into a written decision report (column glossary, model ranking with which to keep, prompt comparison with what to try next). Triggers include "run the eval", "write up the eval results", "eval report", "summarise the model/prompt comparison".
---

# Eval run

Run an analysis eval and turn it into a written analysis so the numbers become decisions. Every section ends with a recommendation, not just data.

## Workflow

Run these in order. Steps 0–2 set up and execute the sweep; steps 3+ are the write-up.

0. **Review the test matrix** — read `docs/eval-runs/test-matrix.md` first. It is the versioned source of truth for which models and prompts are under test (the `keep` set), what was dropped and why, the current/planned prompt, and the Quality judge. This frames the whole run: you sweep the keep-set plus anything new, and you compare prompts against the current best. If the file doesn't exist yet, note it — you'll create it in the *Maintain the test matrix* step.
1. **Check for new model versions and suggest** — before running, see what the account can now reach that the matrix doesn't yet list. Discover accessible on-demand text models and diff against the matrix rows:
   ```bash
   AWS_PROFILE=prod aws bedrock list-foundation-models \
     --region eu-west-2 --by-output-modality TEXT --by-inference-type ON_DEMAND \
     --query "modelSummaries[].modelId" --output text | tr '\t' '\n' | sort
   ```
   Cross-reference with `scripts/run-eval.sh` presets (`frontier`/`core`) too. Any model **not** already a matrix row (or explicitly `dropped`/`retired`/`not tested` there) is a candidate. **Surface the candidates to the user with a one-line recommendation each** (include / skip, and why — newer version of a kept model, a vendor not yet covered, etc.) and let them decide before the sweep. Note that newer Claude/Llama tiers are often inference-profile-only and won't appear as `ON_DEMAND` by raw id — call that out rather than assuming they're unavailable. Don't silently expand the sweep; the matrix is the agreed set.
2. **Run the eval** — `make eval` (needs AWS creds, e.g. `AWS_PROFILE=prod make eval`). To sweep a specific set, pin `EVAL_MODEL_IDS="id1,id2"`; to use a preset, `EVAL_PRESET=frontier make eval`. This runs the offline preflight, then the live matrix, then renders `report.md`. If a sweep already ran and you only need the report, render it without re-running (see *Inputs*). See the [analysis-eval-harness guide](../../../docs/guides/analysis-eval-harness.md) for the full command set, prompt selection, and how to tail progress.
3. **Write the report** — the sections below.
4. **Maintain the test matrix** — bump and update `docs/eval-runs/test-matrix.md` (see that section), folding in any models the user agreed to add in step 1.
5. **Propose the next improvement** — record what to try next in the standing backlog (see *Feed the improvement backlog*).

## Inputs

These are produced by the `make eval` run in step 2 of the workflow:

- `tests/Analysis.Eval/bin/Debug/net10.0/Results/<runId>.jsonl` — one row per fixture × prompt × model (every score).
- `tests/Analysis.Eval/bin/Debug/net10.0/Results/report.md` — the aggregated table. If a sweep already wrote `.jsonl` rows but `report.md` is missing, render it (no re-run):
  `RUN_BEDROCK_EVAL=1 dotnet test tests/Analysis.Eval/Analysis.Eval.csproj --no-build --filter "Category=Report"`

First inspect the `fixtureId`s:
- **named** (`NN-short-description`) → **synthetic** corpus: gold labels exist, so Tag/Action/Content **F1** are valid alongside Quality.
- **GUID-like** → **real meetings**: only **Quality** and **Faithfulness** are meaningful (no gold labels). Treat as private.

## Output

Write `docs/eval-runs/<YYYY-MM-DD>-<slug>.md`.

> **Never paste transcript or meeting content** — the repo is public and real fixtures are private. Aggregate scores, model names, and prompt versions only.

## Sections

| # | Section | Must contain |
|---|---------|--------------|
| 1 | Run metadata | Date; fixtures (count + synthetic/real); prompts compared; models swept; Quality judge model; caveats (e.g. uneven completed counts from throttling skips). |
| 2 | Results | Paste `report.md`, best-Quality-first. |
| 3 | Column glossary | Per column: what it measures, how much to trust it, its decision weight. Flag **saturated** columns (e.g. Faithfulness near 1.0 = no signal) and **caveat** columns (fewer Fixtures = less reliable). |
| 4 | Model summary | Rank by Quality; per-model strengths/weaknesses by dimension; name the universal weak dimension; then **keep vs drop** weighing cost vs quality. |
| 5 | Prompt summary | Compare versions per model and overall; quantify each move ("V3 lifted Opus +0.06, tags 0.51→0.71"); then **which prompt to keep** and **what the next iteration targets** (usually weakest dimension). |
| 6 | Caveats & confidence | Uneven fixture counts; **judge family-bias** (same-vendor judge inflates that vendor — recommend held-out non-vendor re-run to confirm a lead); sample size; synthetic vs real. |

## Maintain the test matrix (every run)

After writing the report, update **`docs/eval-runs/test-matrix.md`** — the versioned source of truth for which models and prompts are under test. **This file drives the sweep:** `EVAL_PRESET=keep make eval` reads the model id from every `**keep**` row, so editing the matrix here changes what the next run tests — there is no second list to sync.

- **Bump the version** (integer) and set the date + the `runId` it reflects.
- **Apply this run's decisions:** mark dropped models `dropped (<date>)` with a one-line reason; keep the survivors; add any newly-introduced models/prompts; mark the current production prompt and any planned next prompt.
- **Append a changelog line:** `vN (<date>, <runId>): <what changed and why>`.
- **Preserve the `**keep**` status format** on kept-model rows — the `keep` preset greps for that exact bold token to build the sweep, so a model is only tested if its status cell reads `**keep**`. Changing a row to any other status drops it from the next run automatically.
- Never delete rows — mark them `retired`/`dropped` so the history of what was tried (and why it was cut) survives.

If `docs/eval-runs/test-matrix.md` doesn't exist yet, create it: a short intro, a **Models under test** table (`Model | Status | Notes`), a **Prompts under test** table (`Prompt | Status | Notes`), and a **Changelog**.

## Feed the improvement backlog (every run)

Model/prompt improvement is open-ended, so the next thing to try is tracked in the standing, unnumbered backlog **`docs/phases/phase-model-prompt-improvements.md`** (items prefixed `MPI-`). After the write-up, the *Prompt summary* and *Model summary* already name the next target (usually the weakest Quality dimension, or a model worth adding/dropping) — turn that into a backlog item:

1. **Draft the next item** from this run's recommendation — a one-line summary plus a short scope (what prompt change / model swap to try, and which dimension it targets), citing this run's report under `docs/eval-runs/`.
2. **Check with the user before recording it.** Present the proposed `MPI-N` item and ask whether to add it (and whether to reword/re-scope). Do **not** append it unsilently — the user owns what goes on the backlog.
3. **On approval**, append a new `MPI-N` row to the Summary table and a matching detail section at the bottom of the doc (format below), with `Status: Open` and a `Depends on` referencing the harness/prompt it builds from. If `docs/phases/phase-model-prompt-improvements.md` doesn't exist yet, note that and create it mirroring the other standing docs (`phase-bugs.md` / `phase-minor-changes.md`): a `**Goal:**` paragraph, a `## Summary` table (`Item | Summary | Status | Depends on`), then one detail section per item.
4. **Close out shipped items.** If this run's decision *ships* a prompt/model that an existing `MPI-` item was driving (e.g. V4 won and is now live), mark that item `Done` with the deciding run — don't leave it Open.

Never delete backlog rows — mark `Done`/`Dropped` with the deciding run so the history of what was tried survives, mirroring `test-matrix.md`.

### MPI item format

Write the detail section so a reader knows **what** and **why** in ten seconds. Lead with the proposal; make the value scannable. Obeys CLAUDE.md `## Writing style` (facts over prose, lead with the conclusion, no windup).

```markdown
## MPI-N — <imperative title, e.g. "Swap-test claude-sonnet-4-6 as the value pick">

**Status:** Open

**Proposal:** <one line — exactly what to do>

**Why it's worth doing:**
- <concrete payoff — what improves, with a number if there is one>
- <another payoff / what it unblocks or decides>

**Cost:** <rough scope (sweeps × models × prompts), and any blocker or "not blocked">

### Steps
1. <step>
2. <step>

- [ ] <acceptance check — measurable>
- [ ] Decision recorded in `docs/eval-runs/` + `test-matrix.md`

**Depends on:** <ids, or —>
```

Rules for the write-up:
- **Proposal is one line.** If it needs two, it's two items.
- **Every "Why" bullet is a concrete payoff** (a metric moved, a decision made, a risk removed) — not background. "Keep-set should track current models" is fine; a paragraph of history is not.
- **No stale caveats.** If a blocker is already resolved, state "not blocked" in one clause, don't keep the old warning.
- **No prose paragraphs.** Tables/bullets only.

## Rules

- Lead with the decision. Rank and recommend on the **trustworthy** columns (Quality + its sub-scores); say so when a column is non-discriminating.
- **Quantify** deltas — "+0.06", "0.51→0.71" — never just "better".
- Keep model/prompt recommendations concrete and actionable (keep / drop / verify-then-decide; and the specific next prompt target).
- No meeting content, ever.
