# Phase 29 — Notes-as-prompt: inline `/ai` instructions in a note

**Goal:** Let the user embed an instruction in their Quick notes that the AI **executes** during analysis, with each result shown as its own labelled block in Final Notes. The user marks an instruction with a `/ai ` prefix — e.g. a line `/ai add an agenda for the weekend` — and the generated Final Notes gains a card titled with that instruction and the agenda built from the transcript/notes beneath it. Everything else on the note is summarised as today; only `/ai` lines become instructions. This reuses the existing analysis pipeline almost wholesale — the note already reaches the model (`PromptCatalog.BuildV6`, `src/Api/Services/PromptCatalog.cs:230`); the work is (1) **extracting** the `/ai` lines so they drive execution instead of being summarised, (2) a new prompt version that **executes** each instruction while keeping the summary grounding-first, and (3) a new **additive event → projection field → Final Notes block** to store and show the labelled responses. Because it changes the analysis prompt, it is **eval-gated** like every `phase-model-prompt-improvements` item. Graduated from "Notes-as-prompt: inline AI instructions in the user's notes" in `future-features.md`.

## Summary

| Slice | Summary | Status | Depends on |
|-------|---------|--------|------------|
| 29-A | **Core end-to-end: `/ai` instruction → labelled response.** Extract `/ai` lines from note content (pure helper, stripped from the grounded note text); `analysis@v7` executes each and returns `instructionResponses: [{instruction, response}]` while preserving v6 grounding for summary/discussion/decisions/tags/actions; new additive event `InstructionResponsesRecorded` → `NoteDetailView.InstructionResponses` → per-instruction cards in `FinalNotesView`. Back-compat: a note with no `/ai` line behaves exactly as today. Eval-gated by construction (v7≡v6 for non-`/ai` notes; see MPI-7). | Done (PR #290, deploy 29922b5) | — |
| 29-B | **Discoverability affordance.** An in-editor hint that `/ai ` turns a line into an AI instruction (help text near Quick notes and/or a visual treatment of `/ai` lines), so the feature is findable. Pure UX layered on 29-A; may fold into Stylist. | Not Started | 29-A |

> **29-A is the whole feature end-to-end** through one real `/analyse` call and carries all the risk: the marker extraction, the grounding-vs-execution prompt split (the eval-sensitive part), and the new event/projection/UI. The instruction list is `1..N` from the start — a list of one is the proof; do not artificially cap it. **29-B is invisible-feature insurance**, not new capability — without it the user has no cue that `/ai` exists. Ship 29-A first; 29-B only after the core flow is proven.

**Decisions locked at scoping (2026-06-16):**
- **Disambiguation: `/ai ` marker syntax** (user choice). A line whose trimmed text starts with `/ai ` (case-insensitive, tolerant of a leading markdown list marker `- ` / `* `) is an instruction; everything else is ordinary note content. Chosen over a separate field and over whole-note inference because it is the most predictable, keeps instructions out of the summary grounding cleanly, and is the smallest slice-1 proof.
- **Output shape: per-instruction labelled cards** (user choice). The model returns an ordered list of `{instruction, response}` pairs; Final Notes renders each as a titled block (instruction text + rendered response). This is why the model must return structured pairs, not one free-form blob.
- **Instructions are stripped from the grounded note text.** The handler removes `/ai` lines from the `content` it passes as `USER'S NOTE`, and passes them separately as `Instructions`. This stops an instruction (e.g. "add an agenda") leaking into the summary/discussion as if it were something said in the meeting.
- **Grounding carve-out (the eval-sensitive nuance).** Summary, discussion, decisions, tags, and action items keep v6's grounding-first rule unchanged. Instruction responses **may synthesise/generate as directed** (an agenda, a drafted email) — but must **not present invented facts as things said in the meeting** (an agenda built from discussed topics is fine; inventing attendees or figures is not). v7 must encode this split explicitly.
- **Event model — design deferred to Breaker plan mode** (does not change observable behaviour). Recommendation **(a)**:
  - **(a) New additive sibling event `InstructionResponsesRecorded(NoteId, IReadOnlyList<InstructionResponse>, ModelId, PromptVersion)`** where `InstructionResponse(Instruction, Response)`. Additive — no versioning of the published `AnalysisSummaryRecorded`; instruction responses are conceptually separate from the meeting summary. Recorded by the handler after `RecordAnalysisSummary`, only when the list is non-empty.
  - **(b) Version `AnalysisSummaryRecorded` → V2** with an added `InstructionResponses` field. One event, but edits a published event's shape (must narrow the `EventDeserializer` arm and verify history per the versioning guardrail). Reject unless (a) proves awkward.
- **Not a new projection table — no backfill.** The instruction responses extend the **existing** `NoteDetailView`/`NoteDetailProjection`; historical notes correctly have an empty list (they had no `/ai` lines). So the "new projection ships empty → trigger a rebuild" guardrail does **not** apply — confirm in Scribe rather than running a backfill.

**Learning surface (secondary):** turning user content into prompt control safely — the grounding-vs-execution split measured by the eval harness; an additive event extending an existing projection without a rebuild; keeping a back-compat path (no `/ai` line ⇒ byte-for-byte today's behaviour) provable.

---

## Slices

### Slice 29-A — Core: `/ai` instruction → labelled response in Final Notes

**User value:** Write `/ai add an agenda for the weekend` in your notes, hit generate, and the Final Notes include an agenda built from the meeting — the note becomes part of the prompt.

**Scenarios (GWT):**
- Given a note whose Quick notes contain a line `/ai add an agenda for the weekend`, when I generate final notes, then Final Notes shows a labelled card titled with the instruction and a generated agenda beneath it.
- Given that same note, when analysis runs, then the `/ai` line is **not** summarised or surfaced as a discussion point (it is removed from the grounded note text the model summarises).
- Given a note with two `/ai` lines, when I generate, then two labelled cards appear in order, each matching its own instruction.
- Given a note with **no** `/ai` line, when I generate, then the output is identical to today (summary / discussion / decisions / tags / actions) and **no** instruction-response section renders (back-compat).
- Given a `/ai` instruction asking for content not in the transcript (e.g. `/ai draft a thank-you email`), when I generate, then a response is produced (generative) **while** the summary/discussion/decisions stay strictly grounded — no invented meeting facts leak into them.
- Given the model returned instruction responses, when I reload the note, then the responses persist (read-your-writes via `NoteDetailView`).
- Given a bare `/ai` with no text after it (or only whitespace), when I generate, then it is ignored — no empty instruction is sent and no empty card appears.
- Given a note that contains **only** `/ai` lines (no other content, no transcript), when I generate, then analysis still runs on the instructions (the empty-input 422 guard must treat instructions as input too).
- Given the model omits `instructionResponses` or returns malformed JSON, when analysis runs, then summary/discussion/decisions still record (existing parse-fallback path is unaffected) and the missing-responses case is logged.

**Acceptance criteria:**
- **Pure extractor helper** (e.g. `InstructionExtractor`): `content → (cleanedContent, instructions[])`. Recognises a line whose trimmed text begins `/ai ` (case-insensitive; tolerant of a leading `- `/`* ` list marker); drops empty/whitespace-only instructions; preserves all other lines verbatim into `cleanedContent`. Transport-free and unit-tested (markers mid-word like `path/ai/x` must **not** match; only a line-leading marker).
- **Handler** (`TranscriptionHandlers.AnalyseNote`, `src/Api/Handlers/TranscriptionHandlers.cs:104`): extract before building the request; pass `cleanedContent` as the note content and `instructions` on a new `NoteAnalysisRequest.Instructions` field. The empty-input check (`:105`) proceeds when transcript **or** cleaned content **or** instructions are present.
- **`analysis@v7`** in `PromptCatalog`: add an `INSTRUCTIONS` section listing the extracted instructions and a directive to execute each and return `instructionResponses: [{"instruction": "...", "response": "..."}]`; keep v6's grounding-first rules verbatim for summary/discussion/decisions/tags/actions; add the carve-out (instruction responses may synthesise as directed but must not present invented facts as said in the meeting). When `instructions` is empty, v7's observable output must equal v6's (no `instructionResponses` key needed). Behind the eval harness; `PromptCatalog.Current` flips to v7 only after the eval gate passes.
- **`AnalysisResponseParser`** reads `instructionResponses` as an array of `{instruction, response}` objects (skip entries missing either field); absent ⇒ empty list; parse-fallback behaviour unchanged.
- **Event model:** add `InstructionResponsesRecorded` (recommendation (a)) to `docs/event-model.md` + `docs/event-schemas.md`; handler records it after `RecordAnalysisSummary` when there are responses **or** when a prior run recorded responses that must now be cleared (full snapshot, latest wins — mirrors `RecordAnalysisSummary`). (If Breaker picks (b), version `AnalysisSummaryRecorded`→V2 per the versioning guardrail and verify history.)
- **Projection/view:** `NoteDetailProjection` folds the new event into a `NoteDetailView.InstructionResponses` list; update `docs/view-schemas.md`. **No backfill** (empty is correct for historical notes).
- **Frontend:** `NoteDetail` (`web/src/api/notes.ts`) gains `instructionResponses: {instruction, response}[]`; `FinalNotesView.tsx` renders a per-instruction section (instruction as the card title, response as the body) when the list is non-empty, hidden when empty. The response is **plain text with whitespace preserved** (`white-space: pre-wrap`), matching how `summary` renders — the app has no markdown renderer, so true markdown formatting of responses is deferred to a Stylist pass / 29-B. The "Generate / Re-process" action already exists — no new mutation; this is not an optimistic-update slice (analysis is an explicit, awaited generate action).
- **Eval gate — satisfied by construction (decision 2026-06-17):** `BuildV7` delegates to `BuildV6` byte-for-byte when a note has no `/ai` instruction, and the eval matrix contains **no `/ai` fixtures**, so a v7-vs-v6 run would compare a prompt to itself — zero delta, no information. summary/discussion/decisions/tags Quality cannot regress. Recorded as **MPI-7** in `phase-model-prompt-improvements.md` in lieu of an eval report; v7 ships as `Current`. The new instruction path's correctness is proven by Domain.Specs + Api.Integration + vitest (the eval cannot see it).
- **Tests:** Domain.Specs for the new event/command; unit tests for the extractor (marker matching, list-marker tolerance, empty-instruction drop, no mid-line match) and the parser (`instructionResponses` present / absent / partial); Api.Integration for `/analyse` returning instruction responses via the in-memory Bedrock stub (incl. the no-`/ai` back-compat case, the only-instructions-no-transcript case, and the clear-on-rerun case); FinalNotesView vitest (render cards / hidden-when-empty / only-instructions). Run `npm run lint` on changed frontend files. **No Browser.E2E** for this flow: the suite deliberately has no analysis journey (analysis hits real, non-deterministic Bedrock — an E2E asserting on generated text would be flaky), so the end-to-end flow is proven by Api.Integration against a deterministic fake rather than a browser journey.

### Slice 29-B — Discoverability affordance

**User value:** Users discover that `/ai ` turns a note line into an AI instruction, instead of the feature being invisible.

**Scenarios (GWT):**
- Given the Quick notes editor, when I view it, then a brief hint communicates that starting a line with `/ai ` makes the AI act on it during analysis.
- Given I type a line beginning `/ai `, when the line is recognised as an instruction, then it is visually distinguished from ordinary note text (e.g. a subtle marker/affordance).
- Given the hint/affordance, when analysis runs, then it changes nothing about how instructions are extracted or executed (pure UI — reuses 29-A's path).

**Acceptance criteria:**
- A discoverable cue near Quick notes (help text, placeholder, or a small "/ai" affordance) — exact form decided with Stylist.
- Optional visual treatment of `/ai` lines in the editor; must not alter the stored markdown or the extractor's input.
- No backend, event, prompt, or projection change — this slice is entirely frontend and adds no `/analyse` behaviour.
- Tests: vitest/component for the affordance presence; no new E2E required beyond confirming 29-A's flow still passes. Run `npm run lint`.

---

## Observability

The feature adds a user-controlled execution path to analysis; the silent failure modes are about an instruction quietly not running or the model leaking invented facts.

- **Primary silent failure — instruction extracted but no response returned.** The model ignores a `/ai` line, or the parser drops it, and the user sees a missing card with no signal. **Add a structured log/metric in the handler comparing instructions-extracted vs instruction-responses-returned**; emit on mismatch (e.g. `InstructionResponsesMismatch` with both counts). This is the one new instrumentation the slice warrants.
- **Grounding leak in summary from an instruction.** An instruction's intent bleeds into the grounded summary/discussion. **Not observable in telemetry** — guarded by the v7 prompt split and the **eval gate**, not a metric (flagged, not instrumented).
- **Whole-analysis parse fallback.** Already covered by the existing `AnalysisSummaryEmpty` / parse-fallback contract (`AnalysisResponseParser`, phase-15) — ensure a missing `instructionResponses` key is treated as empty, not as a parse failure, so it does not pollute that signal.
- **No new server resource to alarm** — reuses the existing Bedrock call, Lambda, and DynamoDB table; nothing new to trace or alarm beyond the mismatch log above.

**Known edge (accepted):** the clear-on-rerun logic reads `hadResponses` from the same `NoteDetail` projection snapshot the rest of `AnalyseNote` already reads (content, transcript, tags). Two rapid back-to-back `/analyse` calls where the first's projection write has not yet landed could let the second see `hadResponses == false` and skip the clearing event. Not a new surface (the whole flow already reads that snapshot), requires an explicit user double-generate (the UI awaits each call), and self-corrects on the next analyse — so it is accepted, not guarded.

## Deploy-time impact

**Neutral.** Backend change (new prompt version, additive event, extended projection) but **no new CDK resource** (reuses Bedrock, the existing tables, the existing Lambda) and **no CI/CDK update-behaviour change**. No new projection table ⇒ no backfill step. No per-deploy cost delta. The one gate that adds wall-clock is the **pre-merge eval run** (`make eval`), which is a developer/CI step, not a deploy-path cost.
