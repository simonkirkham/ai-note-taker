# Phase 15 — Split the note into Transcript, Quick notes & Final notes

**Goal:** Stop conflating what the **user wrote** with what the **AI generated**. Today a single `content` field holds both — and when analysis runs with `updateContent`, the AI's gap-fill *overwrites the user's own notes*, so there is no way to tell authored text from generated text. This phase splits the note screen into three clearly-separated views — **Transcript** (raw speech-to-text, already stored), **Quick notes** (what the user typed — the AI never touches it again), and **Final notes** (a new, durable, structured AI artifact: Summary, Discussion, Decisions, Action items, attributed to the model that wrote it) — matching the Transcript / Quick notes / Final notes tab model in the reference screenshot. The core behavioural change is that **AI analysis stops mutating the user's notes** and instead produces a separate first-class artifact. Existing notes are left as-is (their already-merged content stays as Quick notes); the clean split applies forward, from the next analysis run onward.

## Summary

| Slice | Summary | Status | Depends on |
|-------|---------|--------|------------|
| Prototype | Throwaway frontend prototype of the tab layout — **Done**; confirmed Layout B hybrid (Quick notes default, Record+Export inline on the tab row, Tags+Actions in a persistent sidebar, Final notes = Summary/Discussion/Decisions) | Done | — |
| 15-A | **Your notes stay yours, and the AI's notes get their own home.** Running analysis produces a separate, model-attributed Final notes artifact (Summary, Discussion, Decisions, Action items) and *never overwrites* the user's typed notes | Done | — |
| 15-B | **Read a note as three tabs — Transcript, Quick notes, Final notes.** The raw transcript and the user's own notes each get a dedicated view alongside Final notes, per the approved prototype | Done | 15-A, Prototype |
| 15-C | **Regenerate Final notes on demand.** A "Re-process" control re-runs analysis from the Final notes view, with an optimistic pending state and rollback on failure | Done | 15-A, 15-B |

Recommended order: Prototype → 15-A → 15-B → 15-C.

---

## Prototype — three-tab note layout (throwaway, frontend-only)

**Status:** Done — approved 2026-06-03. Built on `prototype/phase-15-note-tabs`; confirmed UX captured in that branch's `web/src/prototype/REFERENCE.md`.

---

## Slice 15-A — Your notes stay yours; the AI's notes get their own home

**Status:** Done — shipped 2026-06-03 (PR #144, deploy #431). Learnings: `docs/learnings/_archive.md`.

**User value:** When analysis runs, the AI writes a **separate, model-attributed Final notes artifact** (Summary, Discussion, Decisions) and **never overwrites** the user's typed notes.

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
- [ ] Final notes view renders summary/discussion/decisions + model attribution + empty-state CTA (action items stay in the existing sidebar section, not inside Final notes); no AI-written text ever appears in the Quick-notes editor
- [ ] Eval harness updated to structured output; nightly `eval.yml` green
- [ ] Domain spec + Api.Integration read-shape test + frontend component test green; `docs/event-model.md`/`event-schemas.md`/`view-schemas.md` updated (incl. the `transcriptText` drift fix); `cdk synth` succeeds

---

## Slice 15-B — Read a note as three tabs: Transcript, Quick notes, Final notes

**Status:** Done — shipped 2026-06-03 (PR #149, deploy #435). Learnings: `docs/learnings/_archive.md`. (Phase 14-O "migrate TranscriptionPanel" was dropped as superseded — 15-B deletes that component.)

**User value:** The note screen becomes a clean three-tab reading experience — Quick notes, Transcript, Final notes — so at a glance it is obvious which surface is the user's and which is the AI's.

### Scenarios

```
Scenario: A note opens on Quick notes with three labelled tabs
  Given a note
  When  I open it
  Then  the Quick notes tab is selected by default
  And   I can switch to the Transcript and Final notes tabs

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
  Then  I see the summary, discussion, and decisions, with model attribution from 15-A

Scenario: Tags and action items stay visible across tabs
  Given any tab is selected
  Then  the Tags and Action items sidebar is visible
  And   action items are shown only in the sidebar, not inside Final notes

Scenario: Recording and export are reachable from the tab row
  Given any tab is selected
  Then  the Record and Export controls are available inline on the tab row
```

### Acceptance criteria

- [ ] Note view renders the tabs in order **Quick notes · Transcript · Final notes**, with Quick notes selected by default
- [ ] Record + Export controls sit inline on the tab row (moved out of `TranscriptionPanel`)
- [ ] Tags + Action items remain in a persistent sidebar visible on every tab; action items are not duplicated inside Final notes
- [ ] Quick notes remains the existing editor and saves via `editContent`; no AI-written text appears in it
- [ ] Transcript tab is read-only; Final notes reuses the 15-A view component (not rebuilt)
- [ ] Component tests cover default tab + tab switching + read-only transcript + Quick-notes editing + sidebar persistence; the kept E2E note journey updated and green
- [ ] No styling regression (coordinate with Phase 14 if it lands first); existing Vitest suite green

---

## Slice 15-C — Regenerate Final notes on demand

**Status:** Done — shipped 2026-06-03 (PR #153, deploy #437). Learnings: `docs/learnings/_archive.md`. Failure surfacing uses Phase 14-V's `ToastProvider`/`useToast`.

**User value:** The user can re-run analysis on demand from the Final notes view, with an optimistic pending state and rollback-on-failure.

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
