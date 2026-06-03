# Phase 10-G — Analysis evaluation harness + versioned prompts

**Shipped:** 2026-06-03 · PR #132 · deploy #418 green

## What landed

An offline, opt-in LLM evaluation harness (`tests/Analysis.Eval/`) that runs prompt/model variants over fixed meeting transcripts and scores three dimensions — tags (set P/R/F1), action items (normalised P/R/F1), and content gap-fill (LLM-as-judge) — emitting one jsonl row per fixture×prompt×model and a markdown report. Plus the production "versioned prompts" refactor: `BedrockAnalysisService` now takes an injected `AnalysisPrompt` + `modelId`, the `analysis@v1` prompt lives in `PromptCatalog`, and `NoteAnalysisResult` self-describes with `ModelId`/`PromptVersion`. A nightly (+ manual) `eval.yml` runs the matrix and uploads the report. Every Bedrock-touching test is gated on `RUN_BEDROCK_EVAL=1`, so PR/deploy CI never burns Bedrock credit.

## Learnings

### 1. An uncommitted Breaker scaffold rots — and silently (the key one)

The prior attempt left a complete scaffold (~19 files) **uncommitted and unpushed** in a worktree for ~5 days. In that window main moved **100 commits** ahead and slice 10-H replaced the analysis contract (`AnalyseAsync(string, string, string)` → `AnalyseAsync(NoteAnalysisRequest)` with an `AllowContentRewrite` flag). The scaffold's `StubBedrock` implemented the old three-string signature, so it would not even compile against current main — yet nothing flagged this, because the work existed only as untracked files one `git clean` from oblivion.

**Rule:** commit Breaker scaffolds on their branch and push immediately, even when red. A pushed red branch is recoverable and its drift is visible in a diff; an uncommitted working tree is neither. When resuming any paused slice, **first diff its assumed contracts against current main** before building on it.

### 2. Tests that mutate a process-global env var must save and *restore* it — never force a literal

The harness gates live tests on `RUN_BEDROCK_EVAL`. Two unit tests proved the `IsEnabled` read by setting the env var. The first draft *forced* the flag to `null` (and a sibling set `"1"` then `null` in `finally`). Hawk caught the consequence: in the **nightly run the flag is `1`**, and these tests would leave it `null`, so every live matrix test running afterward would **skip** — turning the entire nightly eval into a silent no-op that still reports green. Fix: capture the original value and restore it in `finally`, so the flag returns to whatever the environment set.

**Rule:** a test that writes a process-wide environment variable must snapshot the prior value and restore it, especially when CI sets that same variable. Forcing a literal is a cross-test/CI footgun. (See also the parallelism note below.)

### 3. Process-global mutation also forces serial execution

Even with save/restore, a test mutating `RUN_BEDROCK_EVAL` races other classes that *read* it under xUnit's default per-collection parallelism — observed directly: one gated test caught a transient `"1"` and made a real Bedrock call mid-suite. `[assembly: CollectionBehavior(DisableTestParallelization = true)]` removes the race. The shared-results-file append in `EvalRunner` then also relies on this serialization (documented inline). Small opt-in suite, so serial is free.

### 4. Widen a result record with defaulted fields to avoid churning construction sites

`NoteAnalysisResult` gained `ModelId`/`PromptVersion` with `= ""` defaults, so the ~17 existing constructions in `Api.Integration` tests and the fakes compiled untouched; only the two production `ParseResponse` paths stamp real values. The stamp is a contract addition for the eval harness (and a 10-M precursor), not consumed by the analyse handler yet — explicitly flagged in the phase doc so a future reader doesn't assume it reaches the event store.

### 5. Keep the test-only Bedrock judge's duplication rather than couple projects

The Nova `messages-v1` invoke + `output.message.content[0].text` parse is duplicated between production `BedrockAnalysisService` and the test-side `BedrockContentJudgeClient`. Extracting a shared helper would either leak a test concern into `src/Api` or couple the two projects; the small duplication is the lesser evil. Hawk concurred.

## Phase 10 status

10-G ships the eval harness and `PromptCatalog`/`NoteAnalysisResult` changes that **10-M** depends on. 10-M (version the `*Suggested` events to stamp `modelId`/`promptVersion`) is now unblocked but remains **Not Started**. Phase 10 stays _(In Progress)_.

## Done actions applied

- Added a CLAUDE.md guardrail: tests that mutate process-wide environment variables must snapshot and restore the original value (learning 2).
- The "diff contracts before resuming a paused slice" and "push Breaker scaffolds even when red" takeaways (learning 1) are durable process notes; no config change beyond this doc.
