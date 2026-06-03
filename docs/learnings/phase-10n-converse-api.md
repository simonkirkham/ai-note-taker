# Phase 10-N — Migrate analysis to the Bedrock Converse API

**Shipped:** 2026-06-03 · PR #152 · deploy #436 green

## What landed

The production analyse path (`BedrockAnalysisService`) and the eval judge (`BedrockContentJudgeClient`) now call Bedrock's model-agnostic **Converse API** instead of `InvokeModel` with Amazon Nova's `messages-v1` body. The same code now drives any accessible Bedrock text model, so `make eval` can sweep beyond the Nova family and the production model is swappable via `BEDROCK_MODEL_ID` alone. Two pure helpers were extracted into `src/Api/Services/`: `ConverseResponseReader` (text out of a `ConverseResponse`) and `AnalysisResponseParser` (text → `NoteAnalysisResult`). Graduated from `technical-improvements.md`.

## Learnings

### 1. A transport swap is only "behaviour-identical" if you pin the request *and* the parse

`InvokeModel(messages-v1)` and `Converse` are interchangeable for Nova **only** because the request carried no system prompt, a single user message with the same prompt text, and the same `maxTokens` — and because the response's embedded-JSON extraction is unchanged. The win was isolating those two facts: extracting `AnalysisResponseParser` (pure `text → result`) and `ConverseResponseReader` (pure envelope unwrap) turned an untestable transport method into two offline-unit-tested functions, and made the equivalence reviewable line-by-line rather than asserted by faith. The lesson: when swapping a transport under a hard "no behaviour change" bar, extract the pure parse/shape logic first so the diff is "envelope only".

### 2. Refactors silently drop observability unless you treat logs as contract

The first cut collapsed the parse-failure log into the generic `AnalysisSummaryEmpty` warning, erasing the distinct parse-fallback signal that [phase-15's observability section](../phases/phase-15.md) explicitly mandates — and dropping the captured exception. Hawk caught it against the phase-15 contract. Fix: `Parse` → `TryParse(out result)` so the caller logs three distinct states (parse-fallback / valid-but-empty / success). Then a second Hawk note: the fallback line still reused the `(AnalysisSummaryEmpty)` token, so a metric query on that string would match both — gave the fallback its own `AnalysisParseFallback` marker. **A logged marker string is an API**: a metric/alarm keys off it, so changing or duplicating it is a breaking change. Grep the marker before touching log lines in a path that has an observability contract.

### 3. Pure-function extraction surfaced a latent crash

Pulling the brace-scan into a tested function exposed that the original `endIndex < 0` guard let reversed `} … {` text through to `text[start..(end+1)]` → an **uncaught** `ArgumentOutOfRangeException` (it wasn't in the `JsonException`/`KeyNotFoundException` catch set). Tightened to `endIndex < startIndex` and added a reversed-braces test. The bug pre-existed on main; it only became visible once the logic was unit-testable. Extracting for testability pays for itself by making latent edge cases assertable.

## Scope deferred

- **Cross-region inference-profile models** (Claude 3.5/3.7, newer Llama) need the profile id + member-model IAM across regions — a config/IAM follow-on once a specific non-Nova model is chosen. 10-N keeps the default model Nova Lite and only changes the transport; on-demand Bedrock models (incl. Claude/Llama/Titan/Mistral where access is granted) work now via `EVAL_MODEL_IDS`.

## Phase 10 status

10-N is done; **10-M** (stamp `modelId`/`promptVersion` on the suggestion events) remains Not Started. Phase 10 stays _(In Progress)_.

## Done actions applied

- Added a guardrail note in the slice doc (and here) that a logged marker token is part of the observability contract — grep before changing. No CLAUDE.md change beyond this (the existing [[feedback_react_effect_ordering]]-style guardrails cover process; this one is project-specific to the AnalysisSummaryEmpty/AnalysisParseFallback markers).
