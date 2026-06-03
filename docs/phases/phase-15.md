# Phase 15 — Split the note into Transcript, Quick notes & Final notes

**Goal:** Stop conflating what the **user wrote** with what the **AI generated**. Today a single `content` field holds both — and when analysis runs with `updateContent`, the AI's gap-fill *overwrites the user's own notes*, so there is no way to tell authored text from generated text. This phase splits the note screen into three clearly-separated views — **Transcript** (raw speech-to-text, already stored), **Quick notes** (what the user typed — the AI never touches it again), and **Final notes** (a new, durable, structured AI artifact: Summary, Discussion, Decisions, Action items, attributed to the model that wrote it) — matching the Transcript / Quick notes / Final notes tab model in the reference screenshot. The core behavioural change is that **AI analysis stops mutating the user's notes** and instead produces a separate first-class artifact. Existing notes are left as-is (their already-merged content stays as Quick notes); the clean split applies forward, from the next analysis run onward.

## Summary

| Slice | Summary | Status | Depends on |
|-------|---------|--------|------------|
| Prototype | Throwaway frontend prototype of the Transcript / Quick notes / Final notes tab layout — confirm tab UX, where recording controls/tags/actions live, and the Final-notes section order before any real code | Not Started | — |
| 15-A | **Your notes stay yours, and the AI's notes get their own home.** Running analysis produces a separate, model-attributed Final notes artifact (Summary, Discussion, Decisions, Action items) and *never overwrites* the user's typed notes | Not Started | — |
| 15-B | **Read a note as three tabs — Transcript, Quick notes, Final notes.** The raw transcript and the user's own notes each get a dedicated view alongside Final notes, per the approved prototype | Not Started | 15-A, Prototype |
| 15-C | **Regenerate Final notes on demand.** A "Re-process" control re-runs analysis from the Final notes view, with an optimistic pending state and rollback on failure | Not Started | 15-A, 15-B |

**Ordering notes.** The **Prototype** runs first and is a hard precondition for the tabbed reading experience (15-B). **15-A is the headline value and ships first** — it is the behavioural fix the user actually asked for ("divide what I wrote from what the AI generated"): analysis stops clobbering the user's notes and instead writes a separate, attributed artifact the user can see. 15-A is independent of the prototype because its value (notes are AI-safe; the AI's output is visible and separate) lands regardless of the final tab styling — it surfaces Final notes in a simple dedicated view, which **15-B** then promotes into the polished three-tab layout (Transcript and Quick notes each becoming their own view). **15-C** adds manual regeneration last, since it needs both the new artifact (15-A) and a place to host the control (15-B). Recommended order: A → B → C.

> **Note on slice size.** 15-A is a full vertical slice (it spans the event/command/projection, the Bedrock pipeline, and a first presentation) because the user-visible value — "the AI no longer overwrites my notes and its output appears separately" — cannot be delivered in smaller *visible* increments: the event, the prompt change, and the display are each invisible alone. If the diff proves large, Breaker may sub-split it along the natural *record-the-artifact* → *populate-it-from-analysis* seam during spec-writing, **without** changing the slice's single user-value definition.

**Learning surface:** the first event that is a **pure snapshot of AI output as a first-class domain artifact** — a deliberate contrast with Phase 10, where analysis output reused existing event types (`ContentEdited`, `NoteTagged`) so the domain stayed agnostic to authorship. Here the split *is* the point, so provenance becomes explicit in the model. Also: evolving an LLM prompt from flat to **structured multi-section output** while keeping the Phase 10-G eval harness green across prompt versions; surfacing user-vs-AI provenance cleanly in a **tabbed read view**; and making a **forward-only data-model change** (no migration of historical merged content) deliberately and documenting why.

---

## Prototype — three-tab note layout (throwaway, frontend-only)

**Status:** Not Started

**Why prototype.** This phase replaces today's two-column note layout (`note-content-panel` + `note-right-panel`, with the live transcript in `TranscriptionPanel`) with a tabbed layout. Several interaction questions are genuinely open and cheap to get wrong:

- **Tab model.** Three tabs (Transcript / Quick notes / Final notes) as in the screenshot — confirm default tab on open (new note vs analysed note), and how an in-progress recording surfaces while the user is on another tab.
- **Recording controls.** Today start/stop transcription lives inside `TranscriptionPanel` in the right column. With a Transcript *tab*, where do the record controls live so they're reachable from any tab? (Header? Persistent control bar? On the Transcript tab only?)
- **Tags + action items placement.** The screenshot folds Action items into Final notes and does not show tags. Today both are right-column sections (`TagsSection`, `ActionsSection`). Decide whether tags/actions move into Final notes, stay as a persistent panel beside the tabs, or split.
- **Final notes section order + empty state.** Summary → Discussion → Decisions → Action items, and what the tab shows for a note that has never been analysed (a clear "Run analysis to generate final notes" CTA, *not* an error).

Per the project workflow, prototype code is quick-and-dirty scaffolding on a `prototype/phase-15-note-tabs` branch/worktree, pushed to remote, **never merged**. On approval, the exit procedure rewrites the 15-B scenarios below with the confirmed UX, and real implementation starts fresh from the updated doc. Run the `prototype` skill. No backend, no event-model change, no specs in this step.

---

## Slice 15-A — Your notes stay yours; the AI's notes get their own home

**Status:** Not Started

**User value:** When analysis runs on a note, the AI now writes a **separate Final notes artifact** — a Summary, Discussion points, Decisions, and the extracted Action items — attributed to the model that produced it, and it **never overwrites what the user typed**. The user can see the AI's output as its own thing, distinct from their own notes. This is the behavioural fix at the heart of the phase: "what I wrote" and "what the AI generated" stop being the same field.

**What the user sees:** after analysis (auto-analyse on stop already triggers it, per Phase 10-E), a dedicated Final notes view shows the structured summary with a "Written by {model}" attribution line; their own captured notes are byte-for-byte unchanged. A note that has never been analysed shows a clear "no final notes yet" state, not an error.

> Presented in this slice as a simple dedicated Final-notes view (e.g. its own section/panel); **15-B** promotes the three views into the prototype's tab layout. The Final-notes view component built here is reused, not rebuilt.

### How it works (implementation notes)

This slice spans the model, the pipeline, and a first presentation — that is the cost of a vertical slice, not a layering of three slices.

- **New `Note` event + command** (added to `docs/event-model.md` and `docs/event-schemas.md` per *event-modelling drives design*):
  ```csharp
  public record AnalysisSummaryRecorded(
      NoteId NoteId,
      string Summary,
      IReadOnlyList<string> DiscussionPoints,
      IReadOnlyList<string> Decisions,
      string ModelId,
      string PromptVersion) : NoteEvent;   // full snapshot; latest wins, like ContentEdited

  // Command → event (precondition: note exists, not deleted)
  RecordAnalysisSummary(NoteId, Summary, DiscussionPoints, Decisions, ModelId, PromptVersion)
  ```
  Action items are **not** duplicated into the event — they stay `ActionItem` aggregates (single source of truth) and the Final notes view renders them from the existing `NoteActions` data. The event carries only the three sections with no existing home (Summary, Discussion, Decisions) plus `ModelId`/`PromptVersion` for attribution and prompt traceability (consistent with Phase 10-G's `NoteAnalysisResult`).
- **`NoteDetail` projection + DTO + wire JSON** gain `summary`, `discussionPoints` (`[]` when none), `decisions` (`[]` when none), `summaryModelId`, `summaryPromptVersion`; latest `AnalysisSummaryRecorded` wins; absent ⇒ empty/`null` (a normal "never analysed" state, *not* an error). While here, align `docs/view-schemas.md` §3 with the already-shipped `transcriptText` field it currently omits.
- **Structured `analysis@v2` prompt** (`src/Api/Services/PromptCatalog.cs`): returns `{ summary, discussion[], decisions[], newTags[], newActionItems[] }`, **no `updatedContent`**, and explicitly instructs the model not to edit the user's notes. Register V2 as `Current`; keep V1 for eval history.
- **Internal `NoteAnalysisResult`/`NoteAnalysisRequest`** (unpublished DTOs — free to change): replace `UpdatedContent` with `Summary`/`DiscussionPoints`/`Decisions`; drop `AllowContentRewrite`. The parser falls back to an **empty** summary on malformed JSON (current no-throw behaviour preserved) and logs a warning.
- **`AnalyseNote` handler** (`src/Api/Handlers/TranscriptionHandlers.cs`): remove the `EditContent` gap-fill call entirely; emit `RecordAnalysisSummary` on success; keep the tag path (`RecordTagSuggestions` + `TagNote`) and action-item path (`AddActionItem` + `RecordActionItemSuggestions`) exactly as today; preserve the 503-on-Bedrock-failure response. Remove the now-unused `updateContent` field from `AnalyseNoteRequest` (guardrail: no unread request-contract fields).
- **Eval harness** (`tests/Analysis.Eval/`): update fixtures/judge to the structured output and `analysis@v2` so nightly `eval.yml` stays green.
- **Frontend:** a `FinalNotesTab`/`FinalNotesView` component renders Summary, Discussion, Decisions, Action items (from existing actions data), and the attribution line, with an empty-state CTA; `NoteDetail` TS interface gains the new fields. AI-written text must never appear in the Quick-notes editor.

### Scenarios

```
Scenario: Analysis writes a separate Final notes artifact, not over my notes
  Given a note whose content I typed, with a transcript present
  When  analysis runs
  Then  a Final notes artifact is recorded with a summary, discussion points, and decisions
  And   no ContentEdited event is appended — my quick notes are unchanged
  And   the Final notes view shows the artifact attributed to the model that wrote it

Scenario: Re-running analysis replaces the Final notes (latest wins)
  Given a note that already has Final notes
  When  analysis runs again
  Then  the Final notes view shows only the latest artifact
  And   the full generation history remains in the event stream

Scenario: A note never analysed shows an empty Final notes state, not an error
  Given a note with content but no recorded summary
  Then  the Final notes view shows a "generate final notes" prompt
  And   this is visibly distinct from an analysis failure

Scenario: Tag and action-item extraction is unchanged
  Given analysis runs and the model returns new tags and action items
  Then  tags apply with TagsSuggested provenance and action items with ActionItemsSuggested provenance, as before

Scenario: Malformed model output never corrupts the note
  Given the model returns unparseable output
  When  analysis runs
  Then  an empty summary is recorded (no throw), my quick notes/tags/actions are untouched, and the failure is logged/metered

Scenario: Bedrock unavailable returns 503 and records nothing
  Given Bedrock throws
  When  analysis runs
  Then  the endpoint returns 503 and no Final notes are recorded

Scenario: Final notes survive a projection rebuild
  Given a note stream with two AnalysisSummaryRecorded events
  When  the NoteDetail projection is rebuilt
  Then  it holds the latest summary, discussion, decisions, and attribution
```

### Acceptance criteria

- [ ] `AnalysisSummaryRecorded` event + `RecordAnalysisSummary` command exist; aggregate folds with last-write-wins snapshot semantics; rejected for non-existent/deleted notes
- [ ] `NoteDetail` DTO + wire JSON expose `summary`/`discussionPoints`/`decisions`/`summaryModelId`/`summaryPromptVersion`; empty collections `[]`, never null; absent summary is a normal empty state, not an error
- [ ] Action items are **not** copied into the event — Final notes renders them from existing `NoteActions`
- [ ] `analysis@v2` prompt returns the structured shape with no `updatedContent` and instructs the model not to edit the user's notes; `PromptCatalog.Current` = V2; V1 retained
- [ ] `AnalyseNote` **never** calls `EditContent`; emits `RecordAnalysisSummary` on success; tag/action provenance paths unchanged; 503 path preserved; `AnalyseNoteRequest.UpdateContent` removed
- [ ] Parser falls back to an empty summary on malformed JSON (no throw) and logs the fallback
- [ ] Final notes view renders summary/discussion/decisions/action items + model attribution + empty-state CTA; no AI-written text ever appears in the Quick-notes editor
- [ ] Eval harness updated to structured output; nightly `eval.yml` green
- [ ] Domain spec + Api.Integration read-shape test + frontend component test green; `docs/event-model.md`/`event-schemas.md`/`view-schemas.md` updated (incl. the `transcriptText` drift fix); `cdk synth` succeeds

---

## Slice 15-B — Read a note as three tabs: Transcript, Quick notes, Final notes

**Status:** Not Started

> Scenarios below are the pre-prototype draft. **The Prototype step rewrites this slice** with the confirmed tab UX (default tab, recording-control home, tags/actions placement) before implementation.

**User value:** The note screen becomes the clean three-tab reading experience from the screenshot. The user flips between the raw **Transcript**, their own **Quick notes**, and the AI's **Final notes** — three clearly-labelled surfaces, so at a glance it is obvious which is which. The raw transcript gets its own read-only tab instead of a side panel, and Quick notes is unmistakably the user's space.

**What the user sees:** a note opens with Transcript / Quick notes / Final notes tabs; the Final notes view from 15-A moves into its tab unchanged; the transcript reads in its own tab; recording controls live wherever the approved prototype put them.

**Backend changes:** None (reuses 15-A's fields + the existing transcript/actions data).

### Key implementation files

- `web/src/components/NoteView.tsx` — replace the two-column `note-layout` with the prototype's tab control; route `NoteEditor` into **Quick notes**, the transcript into **Transcript**, and 15-A's Final-notes view into **Final notes**; relocate recording controls + tags/actions per the prototype.
- `web/src/components/TranscriptTab.tsx` (or similar) — **new**; read-only transcript view.
- `web/src/__tests__/` — tab switching, Quick-notes editability, Transcript read-only, Final notes shown in its tab.
- `tests/Browser.E2E/` — update the kept note-screen journey to the tabbed layout.

### Scenarios

```
Scenario: A note opens with three labelled tabs
  Given a note
  When  I open it
  Then  I see Transcript, Quick notes, and Final notes tabs and can switch between them

Scenario: Quick notes is clearly my space and stays editable
  Given the Quick notes tab
  When  I edit and blur
  Then  the content saves via editContent and nothing the AI did has overwritten it

Scenario: Transcript reads in its own tab, read-only
  Given a note with a transcript
  When  I open the Transcript tab
  Then  I see the transcript text and cannot edit it

Scenario: Final notes appears in its own tab
  Given a note with a recorded summary
  When  I open the Final notes tab
  Then  I see the summary, discussion, decisions, action items, and model attribution from 15-A
```

### Acceptance criteria

- [ ] Note view renders Transcript / Quick notes / Final notes tabs; default tab + recording-control placement match the approved prototype
- [ ] Quick notes remains the existing editor and saves via `editContent`; no AI-written text appears in it
- [ ] Transcript tab is read-only; Final notes reuses the 15-A view component (not rebuilt)
- [ ] Component tests cover tab switching + read-only transcript + Quick-notes editing; the kept E2E note journey updated and green
- [ ] No styling regression (coordinate with Phase 14 if it lands first); existing Vitest suite green

---

## Slice 15-C — Regenerate Final notes on demand

**Status:** Not Started

> Scenarios below are the pre-prototype draft; the Prototype confirms where the control lives and its pending affordance.

**User value:** The user can re-run analysis whenever they want — after editing the transcript or their notes — and get fresh Final notes, without leaving the note. A "Re-process" control regenerates the artifact with an optimistic pending state, and on failure it rolls back and tells them, rather than leaving a stale or silently-broken view.

**Backend changes:** None (calls the 15-A `POST /notes/{id}/analyse`).

### Key implementation files

- `web/src/components/FinalNotesTab.tsx` — a "Re-process" / "Generate final notes" button calling the analyse endpoint; show a **pending** state immediately (optimistic-first); on success refresh the note detail; on failure roll back and surface a visible, accessible error (reuse Phase 14's toast/inline-error primitive if present).
- `web/src/components/TranscriptionPanel.tsx` — remove the old `updateContent`-based trigger and `noteHasContent` plumbing; the panel reverts to capture-only, with generation owned by Final notes (keep auto-analyse-on-stop if retained, routed through the new path).
- `web/src/api.ts` — drop `updateContent` from the analyse call payload.
- `web/src/__tests__/` — pending shown on click; success refresh; failure rollback + error surfaced; quick notes unchanged by re-processing.

### Scenarios

```
Scenario: Generating Final notes for the first time
  Given a note with content/transcript but no summary
  When  I click "Generate final notes"
  Then  a pending state shows immediately, and on success the Final notes view shows the new artifact

Scenario: Re-processing replaces the existing Final notes
  Given a note that already has Final notes
  When  I click "Re-process"
  Then  a pending state shows, and on success the view shows the regenerated artifact (latest wins)

Scenario: Re-process failure rolls back and surfaces an error
  Given analysis will fail (503)
  When  I click re-process
  Then  the pending state is rolled back, a visible accessible error is shown, and existing Final notes are unchanged

Scenario: Re-processing never modifies my quick notes
  Given I re-process a note
  Then  my quick-notes content is byte-for-byte unchanged before and after
```

### Acceptance criteria

- [ ] A control in the Final notes view generates/regenerates via the analyse endpoint; pending state appears optimistically; success refreshes; latest summary wins on re-run
- [ ] Failure rolls back the pending state and surfaces a visible, accessible error; existing Final notes left intact
- [ ] Re-processing never alters Quick notes (explicit assertion)
- [ ] `TranscriptionPanel` no longer drives `updateContent`; analyse payload no longer sends `updateContent`
- [ ] Component tests cover pending/success/failure; Vitest suite + kept E2E journey green

---

## Out of scope (explicitly deferred)

- **Per-segment transcript timestamps.** The screenshot shows time markers (`· 0:21`) on discussion points. The transcript is stored as plain text with no per-segment timing, so timestamped bullets are out of scope. (Could become a future feature if transcription is upgraded to emit segments.)
- **The "Notes assistant" Q&A chat.** The modal in the screenshot ("Ask a question about these notes…") is a separate conversational feature, not part of splitting the views. → candidate for `docs/future-features.md`.
- **Copy notes / Export.** The screenshot's Copy/Export buttons are not part of this phase.
- **Un-merging historical notes.** Existing notes keep their already-merged content as Quick notes; no migration attempts to separate previously gap-filled AI text from user text (chosen: forward-only).
- **A separate read endpoint/projection for Final notes.** The artifact rides on the existing `NoteDetail` projection (as `transcriptText` already does); a dedicated projection is unnecessary for the single-note view.

---

## Observability

This phase adds a new production write path (analysis now records a structured artifact and *stops* editing content) and a new read surface. The dominant **silent failure modes**:

1. **Empty Final notes that look "not yet analysed."** If Bedrock returns malformed JSON, the service falls back to an empty summary (preserved from today) — but the user then sees an *empty Final notes view* indistinguishable from a never-analysed note. **Instrument:** emit a metric/log when an analysis run yields an empty summary (`AnalysisSummaryEmpty`) distinct from a successful non-empty record, and log the parse-fallback path. 15-C's UI must show a failure to the user (not a silent empty state) when the analyse call errors.
2. **Summary recorded but not projected.** A fold bug could record the event yet leave `NoteDetail.summary` empty. Mitigated by 15-A's rebuild parity test; at runtime, log the recorded summary's length/section counts on emit so a zero-length record is visible.
3. **Re-process failures (15-C).** A failed analyse call must roll back the optimistic pending state and surface a visible, accessible error (optimistic-failure convention) — never a perpetual spinner or a silently-unchanged view.
4. **Distinguishing "never analysed" from "analysis failed"** in the read model: absence of `AnalysisSummaryRecorded` ⇒ empty + CTA (normal); a failed run ⇒ user-visible error. Keep these two states separate in both the API shape and the UI.

No standalone instrumentation slice is required — fold the logs/metrics above into 15-A (backend) and 15-C (frontend) as acceptance criteria. Phase 12's structured logging, EMF metrics, and the `notetaker-ops` dashboard already exist; these are net additions to that surface. Run the `observability-brief` skill output into the slice acceptance criteria when Breaker drafts the specs.
