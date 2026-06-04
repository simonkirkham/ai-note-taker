# Analysis evaluation harness — testing guide

How to measure and improve the quality of the AI meeting-note analysis (slice 10-G). The harness runs the **real production analysis path** over a fixed set of meeting-transcript fixtures and scores the output, so prompt and model changes are judged on numbers instead of vibes.

- **Code:** `tests/Analysis.Eval/`
- **Prompt catalog:** `src/Api/Services/PromptCatalog.cs`
- **Nightly workflow:** `.github/workflows/eval.yml`

## What it measures

For each fixture the harness builds a `NoteAnalysisRequest`, calls `BedrockAnalysisService.AnalyseAsync`, and scores the result. The **headline metric is Quality** — a holistic, rubric-based judge that encodes *your* definition of a good note (see [The rubric](#the-rubric)). The rest are supplementary diagnostics.

| Score | What it checks | How |
|---|---|---|
| **Quality** (headline) | overall note quality vs the rubric, with sub-scores for **tags / actions / decisions / content** | LLM-as-judge: a neutral model scores 0–1 per rubric dimension + an overall, judged against the transcript (`BedrockQualityJudge`) |
| Tag F1 | inferred tags vs *expected* gold tags | set P/R/F1 (`TagScorer`) — only meaningful on labelled fixtures |
| Action F1 | extracted actions vs *expected* | normalised exact-match P/R/F1 (`ActionItemScorer`) — labelled fixtures only |
| Content (recall) | the artifact contains the *expected* must-mention facts | LLM-as-judge fraction present — labelled fixtures only |
| Faithfulness (precision) | the model's claims are supported by the transcript | LLM-as-judge fraction supported — catches invented content; needs no labels |

**Two judges, two models.** The supplementary Content/Faithfulness judge defaults to **Nova Pro** (`BEDROCK_JUDGE_MODEL_ID`). The headline **Quality** judge defaults to a *neutral* **Claude 3.7 Sonnet** (`BEDROCK_QUALITY_JUDGE_MODEL_ID`) — deliberately not Nova-judging-Nova — and is told to use the full 0–1 range so it discriminates rather than clustering at 0.5.

### The rubric

`Quality` is scored against a fixed rubric (in `BedrockQualityJudge`) that encodes the note-owner's preferences, so the same standard is applied to every model/prompt. Current rubric:

- **tags** — a *minimal* set (ideally 2–3, never >~5) of recurring, findable entities so you can retrieve related notes later (people/companies, work streams, meeting type); over-tagging or generic tags score ≤ 0.4.
- **actions** — *only the current user's own* commitments (others' must not appear) and accurate.
- **decisions** — actual decisions only, accurate, complete, clearly stated.
- **content** — thoroughly captures the substance (a light/sparse note is a major failure, ≤ 0.4, even if faithful), faithful (light inference OK, no invention), flags uncertainty rather than guessing, well-organised (bullets, headers).

To change what "good" means, edit the rubric prompt in `tests/Analysis.Eval/Scoring/BedrockQualityJudge.cs` — that one string *is* the quality definition.

Every run also writes **`Results/<runId>-outputs.md`** — the raw `summary`/`discussion`/`decisions`/`tags`/`actions` each model produced per fixture, with its scores. Read it to *see* why a model scored the way it did rather than trusting the number.

> **Caveat the scores can't fix: fixture realism.** On short, clean synthetic transcripts even a weak model stays faithful, so Faithfulness won't separate models there. The metrics only expose a model's real failure modes when fed inputs that trigger them — long, messy, real meetings. Since this repo is public, real transcripts can't be committed, so `scripts/extract-prod-fixtures.sh` pulls real meetings from the prod note-detail projection into a **git-ignored** `eval-fixtures-real/` (self-protecting), and `EVAL_FIXTURES_DIR` points the sweep at them:

```bash
AWS_PROFILE=prod ./scripts/extract-prod-fixtures.sh
EVAL_FIXTURES_DIR=eval-fixtures-real AWS_PROFILE=prod EVAL_PRESET=keep make eval
```

Real fixtures have no gold labels, so **Quality and Faithfulness** are the meaningful metrics on them (both judge against the transcript, no labels needed) — Tag/Action/Content F1 need hand-authored `expected` values.

> **Why Action F1 catches "only my actions".** The fixtures put the current user's actions in `actionItems` and *other people's* actions in `contentMustMention`. If the model wrongly captures someone else's action as one of the user's, that's an extra predicted item not in `expected` — **precision drops**, so Action F1 < 1. Conversely, the missing-from-content fact lowers the content score. The two scores together pin the "scope actions to the current user" behaviour.

## Running it

Everything that calls Bedrock is gated behind `RUN_BEDROCK_EVAL=1`, so a normal `dotnet test` skips the live cases and runs only the offline unit + corpus tests. To run a real evaluation you need AWS credentials with `bedrock:InvokeModel` (and `bedrock:ListFoundationModels` for model discovery) in a region where the models are available on-demand (Nova models work on-demand in `eu-west-2`).

### Quick start: `make eval`

```bash
AWS_PROFILE=prod make eval
```

This discovers the account's **accessible on-demand text models** in the region (`bedrock list-foundation-models`) — by default the Amazon provider (Nova + Titan) — sweeps the fixtures against all of them, renders the report, and prints it. Models the account can't invoke (no access grant, inference-profile-only) are skipped gracefully — the report only shows models that actually ran. Progress streams to stderr as `[eval N/total] …`. It runs the fast **offline tests first as a preflight** — a trivial failure (e.g. a stale `PromptCatalog` assertion) aborts in seconds *before* the long, paid sweep, not after it — and always renders the report from whatever rows were written, even if the matrix hiccups. Run only the offline tests with `make eval-offline`. The script lives at [`scripts/run-eval.sh`](../../scripts/run-eval.sh).

Since the analyse path speaks the model-agnostic Bedrock **Converse** API (slice 10-N), the sweep is **not** Nova-only. Pick models without pasting a long string (pasting long lines into a terminal can inject a newline mid-id and break it) via a **preset** or **provider**, or pin exact ids with `EVAL_MODEL_IDS`:

```bash
AWS_PROFILE=prod EVAL_PRESET=keep make eval                        # the live keep-set, read from the test matrix ← default for regular runs
AWS_PROFILE=prod EVAL_PRESET=core make eval                        # curated cross-vendor set (Amazon+Meta+Mistral)
AWS_PROFILE=prod EVAL_PROVIDER=all make eval                       # every accessible vendor
AWS_PROFILE=prod EVAL_PROVIDER=anthropic make eval                 # one vendor's on-demand models
AWS_PROFILE=prod EVAL_MODEL_IDS="amazon.nova-lite-v1:0,meta.llama3-70b-instruct-v1:0" make eval
```

**`EVAL_PRESET=keep` is the one to reach for.** It reads the model ids straight from the `**keep**` rows of [`docs/eval-runs/test-matrix.md`](../eval-runs/test-matrix.md), so the matrix is the single source of truth — prune a model there and the next sweep drops it, with no second list to keep in sync. `EVAL_PRESET=core` is the paste-safe way to run a broader one-off cross-vendor comparison.

> Two limits remain: non-Amazon models must be **access-granted** in the Bedrock console first (Claude needs the use-case form + Marketplace sub), and **inference-profile-only** models (newer Claude/Llama) won't appear in discovery — they aren't on-demand by raw id and need the profile id + cross-region IAM (out of scope for now).

### Manual two-phase run

It's a **two-phase** run — populate the results, then render the report:

```bash
# 1. Run the matrix (fixtures × prompts × models) → writes Results/<runId>.jsonl
RUN_BEDROCK_EVAL=1 AWS_PROFILE=prod AWS_REGION=eu-west-2 \
  dotnet test tests/Analysis.Eval/Analysis.Eval.csproj --filter "Category!=Report"

# 2. Render the accumulated results → Results/report.md
RUN_BEDROCK_EVAL=1 \
  dotnet test tests/Analysis.Eval/Analysis.Eval.csproj --filter "Category=Report"
```

Two phases because the report renders whatever rows exist in `Results/`, and test order isn't guaranteed — let the matrix finish writing first.

### Knobs

| Variable | Effect | Default |
|---|---|---|
| `RUN_BEDROCK_EVAL` | `1` enables the live Bedrock tests; anything else skips them | unset (skip) |
| `EVAL_PRESET` | named model set, paste-free: `keep` (the `**keep**` rows of `docs/eval-runs/test-matrix.md` — the matrix drives the sweep), `core` (Amazon+Meta+Mistral, no access grants), or `frontier` (strong model per vendor incl. Anthropic — needs Claude access) | none |
| `EVAL_MATRIX_FILE` | path the `keep` preset reads the keep-set from | `docs/eval-runs/test-matrix.md` |
| `EVAL_MODEL_IDS` | comma-separated analysis models to sweep — pinning these **bypasses discovery** | discovered |
| `EVAL_PROVIDER` | scopes discovery to a Bedrock provider (`amazon`, `anthropic`, `meta`, …) or `all` for every vendor | `amazon` |
| `EVAL_FIXTURES_DIR` | load fixtures from this dir instead of the built-in corpus (e.g. private real meetings from `extract-prod-fixtures.sh`) | built-in `Fixtures/` |
| `BEDROCK_QUALITY_JUDGE_MODEL_ID` | model for the headline **Quality** rubric judge (neutral, non-Nova) | `anthropic.claude-3-7-sonnet-20250219-v1:0` |
| `BEDROCK_JUDGE_MODEL_ID` | model for the supplementary content/faithfulness judge | `amazon.nova-pro-v1:0` |
| `EVAL_REQUEST_DELAY_MS` | pause between sweep cases, to stay under a rate-limited account's Bedrock per-minute quota | `0` (raw `dotnet test`); `make eval` sets `1500` |
| `AWS_PROFILE` / `AWS_REGION` | standard AWS SDK credential/region resolution | — |

**Throttling.** On a low-quota account a full sweep (fixtures × models, plus a judge call each) trips Bedrock 429s. The client uses **Standard** retry with backoff (`MaxErrorRetry=8`), `make eval` paces requests via `EVAL_REQUEST_DELAY_MS=1500`, and any case that still exhausts retries is **skipped** (not failed) — so the report only shows what completed. If you see many skips / uneven `Fixtures` counts, raise `EVAL_REQUEST_DELAY_MS`, sweep fewer models at once, or request a Bedrock quota increase.

Compare two analysis models in one run:

```bash
RUN_BEDROCK_EVAL=1 EVAL_MODEL_IDS="amazon.nova-lite-v1:0,amazon.nova-pro-v1:0" \
  dotnet test tests/Analysis.Eval/Analysis.Eval.csproj --filter "Category!=Report"
```

### Output

Written to `tests/Analysis.Eval/bin/Debug/net10.0/Results/` (gitignored):

- `<runId>.jsonl` — one row per fixture × prompt × model with every score.
- `<runId>-outputs.md` — the raw note each model produced per fixture, with scores (read this to *see* the difference).
- `report.md` — grouped by `(prompt, model)`, **ordered best-Quality first**, with the rubric sub-scores:

```
| Prompt | Model | Quality | Tags | Actions | Decisions | Content | Faithfulness | Fixtures |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| analysis@v2 | amazon.nova-pro-v1:0  | 0.53 | 0.60 | 0.73 | 0.60 | 0.53 | 0.87 | 3 |
| analysis@v2 | amazon.nova-lite-v1:0 | 0.42 | 0.67 | 0.63 | 0.60 | 0.33 | 1.00 | 3 |
```

## Nightly / on-demand CI

`.github/workflows/eval.yml` runs the matrix at **03:00 UTC** and on **manual dispatch** (with an optional `model_ids` input), then uploads `Results/` (jsonl + `report.md`) as the `analysis-eval-results` artifact. It is deliberately separate from PR/deploy CI, which never set `RUN_BEDROCK_EVAL` and so never incur Bedrock cost — though PR CI *does* build the project (warnings-as-errors).

## Fixtures

One JSON file per scenario in `tests/Analysis.Eval/Fixtures/`, auto-discovered by `FixtureLoader`.

```json
{
  "id": "05-sales-pipeline-review",
  "transcriptText": "Dana: ... Marco: I'll send the Acme proposal by end of day. Dana: I'll follow up with Globex ...",
  "existingContent": "Weekly sales pipeline review",
  "currentUserName": "Marco",
  "expected": {
    "tags": ["sales-pipeline-review", "acme", "globex"],
    "actionItems": ["Send the Acme proposal by end of day"],
    "contentMustMention": ["Dana will follow up with Globex on their procurement timeline"]
  }
}
```

### Corpus design rules

The corpus mixes **short, single-topic** meetings (`01`–`18`) with **long, multi-speaker** ones (`19`+: cross-functional syncs, QBRs, postmortems, sprint planning) that have tangents, parked items, several work streams, and the user owning *multiple* actions among many other people's. The long fixtures are the honest stress test — clean short transcripts tend to overstate real-world quality.

Each fixture is shaped to exercise two behaviours:

1. **Tags describe pronouns, streams, and meeting types.** Each fixture's expected tags draw from: **people or companies** (`acme`, `globex`, `tom`, `chen`), a **stream of work** (`renewal`, `checkout-redesign`, `payments-outage`), and a **recurring meeting type** (`1:1`, `sales-pipeline-review`, `qbr`, `sprint-retro`, `board-meeting`, `incident-review`, …). Tags are short and lowercase, matching the prompt's instruction.
2. **Actions are scoped to the current user.** `actionItems` lists **only** the action(s) the `currentUserName` owns. Every fixture also contains at least one **other person's** action, which belongs in `contentMustMention` — never in `actionItems`. This is what makes the harness able to detect action leakage.

`FixtureCorpusTests` (offline, no Bedrock) guards the mechanical parts: all fixtures load, ids are unique, every fixture has ≥1 user action and ≥1 content fact, and `actionItems`/`contentMustMention` are disjoint. Note this is a *proxy* — the JSON carries no speaker labels, so the test can't prove an action was attributed to the right person. **Per-speaker attribution (rule 2) is an authoring-time check**; at eval time, leakage of someone else's action into the user's list shows up as a drop in Action-F1 precision.

### Adding a fixture

Drop a new JSON file in `Fixtures/` following the shape and the two rules above. The id should be `NN-short-description`. It's picked up automatically — no code change. Run `dotnet test tests/Analysis.Eval/Analysis.Eval.csproj` (offline) to confirm it loads and satisfies the corpus rules before spending a paid eval run on it.

## Test a prompt change (the core workflow)

This is the main thing the harness is for: change the prompt, see — on numbers, against your rubric — whether it actually got better. Four steps, ~5 minutes.

**1. Add your new prompt** in `src/Api/Services/PromptCatalog.cs` — copy the existing one and bump the version:

```csharp
public static readonly AnalysisPrompt V3 = new("analysis@v3", BuildV3);

static string BuildV3(NoteAnalysisRequest r) => $$"""
    ... your new prompt text ...
    Reference the inputs with {{r.TranscriptText}}, {{r.ExistingContent}}, {{r.CurrentUserName}}.
    """;
```

**2. Tell the eval to run it alongside the old one** — in `tests/Analysis.Eval/Tests/BedrockEvalTheory.cs`, list both so the report compares them side by side:

```csharp
static readonly AnalysisPrompt[] Prompts = [PromptCatalog.V2, PromptCatalog.V3];
```

**3. Run it** (against your real meetings is best):

```bash
EVAL_FIXTURES_DIR=eval-fixtures-real AWS_PROFILE=prod EVAL_PRESET=keep make eval
```

**4. Read `report.md`.** You get one row per `(prompt, model)`. Compare the `analysis@v3` rows to `analysis@v2`: did **Quality** go up — and specifically the dimension you were trying to fix (e.g. `Content` if you asked for deeper notes, `Tags` if you trimmed tagging)? If yes, ship it by pointing `PromptCatalog.Current` at `V3`. If not, tweak the prompt and rerun.

> Tip: to isolate the prompt, pin one model so prompt is the only variable — `EVAL_MODEL_IDS="amazon.nova-pro-v1:0"`. To compare prompts *and* models at once, leave the preset/provider as-is.

The prompt is versioned and `NoteAnalysisResult` stamps `ModelId`/`PromptVersion`, so the planned **10-M** slice can later tie real user corrections back to the exact prompt version that produced a suggestion.

## Offline tests (what runs without Bedrock)

`dotnet test tests/Analysis.Eval/Analysis.Eval.csproj` with no flag runs the pure-logic tests — scorers, `ContentJudge` (stubbed judge), `EvalRunner` (stubbed Bedrock), `Report`, `FixtureLoader`, `PromptCatalog`, and `FixtureCorpusTests`. The Bedrock-hitting `Score` matrix, the stamp test, and `GenerateReport` skip. This is the fast feedback loop while editing harness code or authoring fixtures.

## Caveats

- **Action scorer is v1** — normalised exact match. A correct-but-paraphrased action counts as a miss, so the fixture `expected` values are phrased close to the model's typical output. There's a noted hook to add embedding-cosine matching if false negatives become noisy.
- **The assembly disables test parallelization** (`AssemblyInfo.cs`). The env-flag tests mutate the process-wide `RUN_BEDROCK_EVAL`, and the runner appends all rows to one `Results/<runId>.jsonl`; both are only safe serially. Don't re-enable parallelism without addressing these.
- **Scores are comparative, not absolute.** Use them to compare variants (`v1` vs `v2`, Lite vs Pro), not as an absolute quality bar — the `expected` values are a curated gold standard, not ground truth.
