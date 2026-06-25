# Phase 38 — Import a transcript manually

**Goal:** let the user create a note from a transcript they already have — **paste raw text** captured in an external tool — instead of recording live in-app. The pasted transcript feeds the **same analysis pipeline** (summary, action items, tags) as a recorded one, so imported transcripts are first-class equals downstream. This is the **manual-paste ingestion path** that de-risks the analyse-an-imported-transcript flow before any third-party connector (Zoom/Teams — [future-features](../future-features.md)). **Reuses the recorded-note events minus audio** (`NoteCreated` → `TranscriptionCompleted` → analysis events); **no new command or event**.

## Summary

| Slice | Summary | Status | Depends on |
|-------|---------|--------|------------|
| 38-A | **Paste a transcript → analysed note (keystone, whole MVP).** New `POST /w/{ws}/notes/import-transcript` on the Command Lambda: in one handler creates the note (`NoteCreated`), appends `TranscriptionCompleted`, then runs analysis passing the pasted text as `transcriptOverride` and identity from the auth context — returns `201 { noteId }` + `X-Consistency-Token` at the post-analysis version. Frontend: an **Import transcript** modal (textarea + button) launched near the new-note control; on submit shows an importing state and navigates to the finished, analysed note. Proves the full import-and-analyse flow on one real call. | Not Started | — |

**38-A is the whole feature.** Plain text only — title, meeting date, attendees, and speaker-labelled/timestamped formats are deferred sub-slices (see *Deferred* below), each additive on the proven pattern.

### Locked decisions

1. **Reuse the recorded-note path minus audio — no new event/command.** The import handler emits `NoteCreated` + `NoteAssignedToWorkspace` (via `CreateNote`) then `TranscriptionCompleted` (via `CompleteTranscription`, `DurationSeconds = 0`). The event sequence is identical to a recorded note minus `RecordingUploaded`/`TranscriptionDiarized`. Imported and recorded notes are indistinguishable downstream.
2. **Single server-side endpoint, not three client calls — to dodge the async-projection race.** Since Phase 27-RYW the `NoteDetail` projection is built **asynchronously** by the Projector Lambda. A client-orchestrated create → set-transcript → analyse fires in milliseconds and `analyse` would read a not-yet-populated projection → `422 NothingToAnalyse` (the BUG-30 "never decide against an async projection" class). One handler on the **Command Lambda** sidesteps it: it appends to the strongly-consistent event stream and feeds analysis the pasted text **directly** as `transcriptOverride`, reading owner identity from the auth context — never the projection.
3. **`AnalyseAsync` tolerates a missing projection when a `transcriptOverride` is supplied.** Today `AnalyseAsync` returns `NothingToAnalyse` when `noteDetailStore.GetAsync` is null (`NoteAnalysisService.cs:34-35`). For a just-created import the projection row does not exist yet. Change: when `detail is null` **and** `transcriptOverride` is non-empty, proceed with empty content, no `/ai` instructions, empty existing-tags, and `userName` as the owner name. **The recorded path (detail present) is unchanged** — zero regression surface.
4. **Synchronous import — the request returns after analysis completes.** Mirrors the existing synchronous `POST .../analyse` (blocks on Bedrock, returns when done). The returned `X-Consistency-Token` is the note stream at the **post-analysis** version, so the frontend's first read shows the fully-analysed note. UX: paste → "Importing…" → land on a finished note.
5. **Analysis failure still saves the note.** If Bedrock fails (`ServiceUnavailable`), the transcript is already committed — return `201 { noteId }` (transcript saved) and let the note open in an unanalysed state the user can re-analyse, rather than failing the whole import. The transcript must never be lost to an analysis outage.
6. **Empty/whitespace transcript is rejected — `400`, no note created.** Don't create an empty note from a blank paste.

### Deploy-time impact

**Neutral.** One new route on the existing Command Lambda. No new event, projection, table, or infra; no backfill. The synchronous Bedrock call adds latency to the **import request** only (same as the existing `/analyse` call), never to deploys. Confirm and state the delta in the 38-A PR.

---

## Slice 38-A — Paste a transcript → analysed note

**Capability:** paste transcript text and get a created, analysed note opened, identical to a recorded one minus audio.

### Backend

- **Endpoint:** `POST /w/{workspaceId}/notes/import-transcript`, body `ImportTranscriptRequest(string TranscriptText)`, Command Lambda, workspace-membership auth (existing middleware on `/w/{ws}/…`).
- **Handler:** new `ImportTranscript` handler (`src/Api/Handlers/`): validate non-empty → `CreateNote` → `CompleteTranscription(noteId, text, 0)` → `NoteAnalysisService.AnalyseAsync(noteId, userId, workspaceId, userName, transcriptOverride: text)` → set `X-Consistency-Token` at the final note version → `201 { noteId }`.
- **`AnalyseAsync` change:** null-detail-with-override path (locked decision 3).
- **No** request-contract field the handler does not read (no unused `title`/`date` in 38-A).

### Frontend

- **Entry point:** an **Import transcript** button beside the existing new-note / record affordance; opens a modal with a transcript `<textarea>` and an **Import & analyse** primary button (disabled while empty).
- **Optimistic UI (mandatory):** on submit the button shows **Importing…** and is disabled immediately (no wait-then-react); on `201` navigate straight to the new note and gate its read on the returned consistency token — no manual refresh. On error the modal stays open with the pasted text **preserved** and an inline error; the textarea is never cleared on failure.
- Reuse the existing analysing/loading affordance on the note view for the brief gated read.

### Scenarios (GWT)

Domain/API (`Api.Integration`, stubbed `IBedrockAnalysisService`):
1. Given a workspace member, When `POST .../import-transcript` with non-empty text, Then a note exists whose transcript is that text and whose stream is `NoteCreated → NoteAssignedToWorkspace → TranscriptionCompleted → AnalysisSummaryRecorded → TagsSuggestedV2 → ActionItemsSuggestedV2`.
2. Given the same, Then the response is `201` with `{ noteId }` and an `X-Consistency-Token` at the post-analysis version.
3. Given whitespace-only `TranscriptText`, Then `400` and no `NoteCreated` event is appended.
4. Given Bedrock throws, Then the response is still `201 { noteId }`, the note exists with its transcript, and no summary/tags/actions are recorded.
5. Given the imported note, Then it is indistinguishable from a recorded note downstream (appears in `/notes/cards`, analysis fields populated) — i.e. the import path reuses the recorded events.

Frontend (`vitest`):
6. Given the Import-transcript modal, When text is entered and **Import & analyse** clicked, Then the import API is called once with the text and the button shows **Importing…**.
7. Given a `201` response, Then the app navigates to the returned note id.
8. Given an error response, Then the modal stays open, the pasted text is preserved, and an inline error shows.
9. Given an empty textarea, Then the **Import & analyse** button is disabled.

E2E (`Browser.E2E`, gated read — drive the gated `/notes/cards`/note read, **never** `/notes/search`):
10. Given a signed-in user, When they import a transcript, Then they land on a note whose transcript text is visible (reload-tolerant, token-gated). *Do not assert specific AI output — Bedrock latency/content is non-deterministic; assert the transcript is present and the note opened.*

### Acceptance criteria

1. New route reuses `NoteCreated` + `TranscriptionCompleted` + analysis events — **no new event or command type**.
2. Import is one server-side call on the Command Lambda; analysis reads the pasted text via `transcriptOverride`, never the async projection — no `422`/404 race.
3. `AnalyseAsync` recorded-note path (detail present) is byte-unchanged; only the null-detail-with-override branch is added.
4. Empty/whitespace transcript → `400`, no note created.
5. Bedrock failure → note still saved (`201`), opens unanalysed and re-analysable.
6. Optimistic UI: immediate **Importing…** feedback, auto-navigate on success (no refresh), pasted text preserved on error.
7. Deploy-time delta stated in the PR (expected: neutral).

### Deferred (future sub-slices, not in 38-A)

- **38-B (later):** optional **title** on import (`RenameNote` after create).
- **38-C (later):** meeting **date** + **attendees** (`SetNoteDate`, attendee handling).
- **Later:** speaker-labelled / timestamped transcript formats (ties into Phase 33 diarization).

---

## Observability

| Risk (silent failure) | What must be visible | Where |
|---|---|---|
| Import saves the note but analysis silently fails (Bedrock 503) | Existing `AnalysisFailed` metric + per-note error log already fire inside `AnalyseAsync` — confirm they cover the import caller (they do; same service). | `NoteAnalysisService.cs:61-64` |
| Imports failing validation (empty paste) inflating client errors | Structured log on the `400` path (warn, with workspace id, no transcript body). | new `ImportTranscript` handler |
| Import volume / latency invisible | Log one structured line per successful import (note id, transcript length, analysis outcome) so the new ingestion path is countable separately from recordings. | new `ImportTranscript` handler |

No new metric/alarm required — the import path rides the existing analysis metrics. Add only the structured import log line.
