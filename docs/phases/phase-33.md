# Phase 33 — Higher-quality speaker-labelled transcripts via Amazon Transcribe batch

**Goal:** After a recording stops, produce a **cleaner, speaker-diarized transcript** than live streaming gives, by running an **Amazon Transcribe batch** job (`ShowSpeakerLabels`) over the captured audio and replacing the streamed transcript with the diarized result (then re-analysing). Live streaming stays for the in-call experience; batch is a **post-call refinement** that coexists with it — never a big-bang cutover.

## Summary

| Slice | Summary | Status | Depends on |
|-------|---------|--------|------------|
| 33-A | **Save the call recording.** Tee the live 16 kHz mono PCM into a WAV; on Stop, upload it to a new `notetaker-recordings` S3 bucket (presigned PUT, 7-day lifecycle expiry). Exposes a "Download recording" link on the note. Standalone value (audio safety net) + the audio-retention contract 33-B consumes. | Done (#324, deploy #624) | — |
| 33-B1 | **Diarized transcript replaces the streamed one (async path, no re-analysis).** New `POST /notes/{id}/transcription/diarize` starts a Transcribe **batch** job (`ShowSpeakerLabels`) on the uploaded audio; job completion arrives via **EventBridge → a new dedicated completion Lambda** that fetches the result, parses speaker turns → new `TranscriptionDiarized` event → transcript replaced in `NoteDetail`. UX: a "Refining transcript…" chip that resolves to the speaker-labelled transcript (reload-tolerant poll). | Done (#328, deploy #631) | 33-A |
| 33-B2 | **Re-analysis on the diarized transcript.** Extract the analysis flow (`AnalyseNote`) into a callable service that runs without HTTP scope; the completion Lambda invokes it after appending `TranscriptionDiarized` so summary/tags/actions are gap-filled on the cleaner transcript. | Not Started | 33-B1 |

> **Slice order.** 33-A (Done) shipped the audio retention + S3 upload. **33-B1 proves the cross-cutting async contract on one real call** — job → EventBridge → completion Lambda → `TranscriptionDiarized` → transcript replaced — with **no re-analysis**, so the hard part (the async job→event→read loop, exactly the shape behind the 27-C revert) is surfaced and shippable alone. **33-B2** then scales it: extract analysis into a non-HTTP callable and re-run it from the completion handler. Never one big-bang slice.

## Decision record (spike, 2026-06-23)

Recorded so it survives deletion of the throwaway spike (`spike-diarisation/`, gitignored).

| Question | Decision | Evidence |
|---|---|---|
| Diarization engine | **Amazon Transcribe batch `ShowSpeakerLabels`** | Cleaner separation **and** tighter transcription than WhisperX-`small`+pyannote on the same audio; zero local ML stack to install/operate. |
| Batch vs live streaming | **Batch as a post-call refinement; keep streaming for live UX** | Streaming gives the in-call transcript; batch gives final quality. Coexist, don't cutover. |
| Channel-ID (mic-L vs system-R) for local/remote split | **Rejected** | User records on **speakers**, so the mic re-captures the system audio (low-energy but intelligible bleed). Both channels carry the call → no clean split. |
| Offline acoustic echo cancellation to recover a clean local channel | **Rejected — tested and failed** | Delay-aligned FDAF/block-NLMS gave ~1 dB ERLE; the cleaned-local transcript was **identical** to the original (narration not removed). Defeated by constant double-talk + non-linear/reverberant speaker path; production WebRTC AEC3 can't use the cross-app remote audio as its echo reference. |
| WhisperX / pyannote (local) | **Rejected for now** | No clear quality win over batch; heavy CPU/torch stack; pyannote model gating. Re-evaluate only if on-device/offline becomes a requirement. |

**Net:** for the real-world speaker setup, **voice-based diarization (Transcribe batch), not channel separation**, is the path. The stereo recorder built in the spike is *not* needed for production — a 16 kHz mono mix (what streaming already produces) is sufficient input for diarization.

## Event model changes (added at implementation time)

- **New event `RecordingUploaded` (v1)** on the Note aggregate (33-A): `{ AudioKey }`. Latest-wins (re-record overwrites). New deserializer arm; `NoteDetailView` folds it into `RecordingAudioKey`.
- **New event `TranscriptionDiarized` (v1)** on the Note aggregate (33-B1): `{ Text, SpeakerCount, JobId, SourceAudioKey }`. Latest-wins over `TranscriptionCompleted` for the note's transcript. New deserializer arm; `NoteDetailProjection` folds `Text` into `TranscriptText` **and sets `TranscriptIsDiarized = true`** (the flag the frontend polls to clear the "Refining…" chip). Re-analysis is **33-B2**, not the fold.
- No change to `TranscriptionCompleted` (immutable). Streaming still appends it; the diarized event supersedes it when the batch lands.

## 33-A scenarios & acceptance criteria

Decisions (2026-06-23): buffer all PCM in memory + single presigned PUT on Stop (multipart deferred); lazy presign-download endpoint (no short-TTL URL cached in the projection).

**Domain** (`tests/Domain.Specs`)
- Given a note, When `SaveRecording(audioKey)`, Then a `RecordingUploaded{AudioKey}` event is appended.
- Given a note with a recording, When a newer `SaveRecording` arrives, Then the latest `AudioKey` wins.
- Given an empty/whitespace `audioKey`, When `SaveRecording`, Then rejected (validation).

**API** (`tests/Api.Integration`)
- `POST /notes/{id}/recording/presign-upload` → presigned PUT URL + `recordings/{noteId}/...` key (content-type `audio/wav`, size cap). Mirrors images presign.
- `POST /notes/{id}/recording` with the key → appends `RecordingUploaded`; ownership authorized **from the event stream** (Command Lambda); 404 for non-owner.
- `POST /notes/{id}/recording/presign-download` → presigned GET URL (15-min TTL) when a recording exists; 404 when none.
- `GET /notes/{id}` exposes `recordingAudioKey` (presence ⇒ recording exists).

**Frontend** (`web`)
- During recording, tee the existing 16 kHz mono 16-bit PCM into a WAV buffer (no second AudioContext).
- On Stop: encode WAV → presign-upload → PUT to S3 → POST the key.
- **Optimistic UI (mandatory):** "Download recording" link appears immediately on Stop; reconciles/hides on upload error.
- NoteView renders a "Download recording" link in the Transcript tab when `recordingAudioKey` present; click → presign-download → browser download.

**Infra** (`src/Infrastructure`, CDK)
- New `notetaker-recordings` S3 bucket: `RemovalPolicy.DESTROY`, 7-day lifecycle expiry, block-public, CORS for PUT+GET. Grant Command Lambda `GrantReadWrite(commandFunction, "recordings/*")`; bucket name via constructor env dict. Deploy-time: neutral (one-off infra add).

**Observability:** structured log on save; frontend metric `recording.upload.failed` on the upload error path.

**Acceptance:** recording captured → uploaded to S3 → downloadable from the note; optimistic link; non-owner blocked; objects expire after 7 days.

## 33-B1 scenarios & acceptance criteria

Decisions (2026-06-23): completion handler is a **new dedicated non-HTTP Lambda** (`src/TranscribeCompletion/`, modelled on `src/Projector/`), driven by an EventBridge "Transcribe Job State Change" rule — not the Command Lambda multiplexing HTTP + async. **No re-analysis in B1** (that is B2). Diarization is **auto-triggered after a successful recording upload** (the whole point is a better transcript); the job name encodes the noteId so completion maps back. Backend mirrors the frontend `speakerSegments.ts` assembly to turn items+speaker_labels into `Speaker N:` text.

**Domain** (`tests/Domain.Specs`)
- Given a note, When `RecordDiarizedTranscription(text, speakerCount, jobId, sourceAudioKey)`, Then a `TranscriptionDiarized` event is appended.
- Given a note with a `TranscriptionCompleted`, When `TranscriptionDiarized` is applied, Then the aggregate's transcript is the diarized text (latest wins).
- Given a note, When the diarized text is blank, Then rejected (never blank the note).
- Projection: `NoteDetailProjection` folds `TranscriptionDiarized` → `TranscriptText = Text`, `TranscriptIsDiarized = true`, `LastModifiedAt` updated.

**API — diarize trigger** (`tests/Api.Integration`, Command Lambda)
- `POST /notes/{id}/transcription/diarize` with the `recordings/{noteId}/...` key → starts a Transcribe batch job (`StartTranscriptionJob`, `ShowSpeakerLabels`, `MaxSpeakerLabels`, `en-GB`, output to the recordings bucket); returns 202. Ownership authorized **from the event stream**; 404 non-owner; 400 key outside the note prefix.
- The job is named/tagged so the completion handler recovers the noteId (e.g. `diarize-{noteId}-{guid}`).
- `GET /notes/{id}` exposes `transcriptIsDiarized` (false until the diarized event lands).

**Completion handler** (new Lambda; `tests/` — unit-level on the parse + append, since it is non-HTTP)
- On a COMPLETED event: `GetTranscriptionJob` → fetch result JSON from S3 → parse `results.items` + `results.speaker_labels` into `Speaker N:` text → append `TranscriptionDiarized`. Owner/workspace read from the note's `history[0].Metadata` (no HTTP scope).
- On a FAILED event: structured log + metric `transcribe.batch.failed`; the streamed transcript is left intact (never blanked).
- Parse error on the result JSON: log + keep the streamed transcript.

**Frontend** (`web`)
- After a successful recording upload, trigger diarization and show a "Refining transcript with speaker labels…" chip.
- Poll `GET /notes/{id}` (reload-tolerant, RYW-gated) until `transcriptIsDiarized` is true, then show the speaker-labelled transcript and clear the chip.
- On job failure/timeout: clear the chip, keep the streamed transcript, surface a non-blocking notice.

**Infra** (`src/Infrastructure`, CDK)
- New `TranscribeCompletion` Lambda host (own log group, longer timeout) — handler for the EventBridge event; granted `transcribe:GetTranscriptionJob`, S3 read on the recordings bucket, and event-store read+append.
- EventBridge rule: source `aws.transcribe`, detail-type "Transcribe Job State Change", `TranscriptionJobStatus` ∈ {COMPLETED, FAILED} → target the completion Lambda.
- Command Lambda granted `transcribe:StartTranscriptionJob`.
- **Deploy-time:** one-off infra add (new Lambda + EventBridge rule + IAM); recurring delta **neutral**.

**Observability:** metric `transcribe.batch.completed` with duration; log job id + note id on every transition; alarm on `transcribe.batch.failed`.

**Analysis is untouched in B1.** The existing on-Stop auto-analyse still runs once on the *streamed* transcript; B1 adds **no** second analyse, so there is no double-analysis within B1 (the diarized event only replaces the transcript text — the Final notes reflect the streamed transcript until B2). Single-analysis deferral is **33-B2**, which introduces the only other analyse.

**Acceptance:** stop a recording → batch job runs → on completion the transcript becomes speaker-labelled and the chip clears, **proven on one real call**; a failed job leaves the streamed transcript intact; non-owner cannot diarize.

> **RYW/async guardrail (mandatory):** the diarized transcript is read from the async projection with **no consistency token the frontend holds** (the event is appended seconds-to-minutes later by the completion Lambda). The frontend read must be a reload-tolerant poll, and the E2E journey must both (a) wrap the post-completion assertion in a reload-to-re-gate helper and (b) warm/drain the projector. This is the 27-C lesson — surface the async-read contract on this slice, not in production.

### E2E scope decision (implementation, 2026-06-24)

**No deploy-gate E2E journey for the full diarization round-trip.** Rationale (CLAUDE.md *deploy-time is a first-class cost*):
| Reason | Detail |
|---|---|
| No recording E2E infra exists | The streaming/recording path itself has **no** Browser.E2E journey (real mic + Transcribe streaming is impractical to drive headlessly); there is nothing to extend, and the only existing journey is `NoteTabsJourney`. |
| A real round-trip is minutes long | A genuine batch job (record → upload → `StartTranscriptionJob` → completion) takes **seconds-to-minutes**; a blocking gate journey waiting for it would add minutes to **every** deploy — exactly the recurring per-deploy cost the guardrail forbids introducing silently. |
| The guardrail's specific failure mode doesn't apply | The guardrail mandates making **pre-existing** sync-read journeys reload-tolerant when a read flips async. This slice **adds** a new diarized read consumed only by **new** frontend code that already polls reload-tolerantly; it does not flip any pre-existing journey's read (the streamed-transcript read was already async since RYW). |

**Coverage instead:** the async loop is unit-tested (`TranscribeCompletionFunctionTests` — COMPLETED/FAILED/empty/poison/note-gone, plus `TranscribeResultParserTests`), the trigger is integration-tested (`NoteRecordingsIntegrationTests` — 202/400/404), the frontend chip/poll is unit-tested (`TranscriptTab.test.tsx`), and the one-real-call acceptance is a **mandatory Scribe post-deploy verification** (record a short call → confirm the transcript becomes speaker-labelled and `transcribe.batch.completed` fires). Re-evaluate a gate journey if/when a headless recording harness exists.

## 33-B2 scenarios & acceptance criteria

**Goal:** analyse exactly **once** per recording, on the *winning* transcript — the diarized one when the batch job succeeds, the streamed one when it fails. No double-analysis, no Final-notes flicker.

Decision (2026-06-23): **defer to a single analysis.** When the frontend triggers diarization it **suppresses the on-Stop auto-analyse**; the one analyse then runs server-side on whichever transcript wins. Manual "Analyse" (auto-analyse toggle OFF, or the explicit button) is unaffected — it is always honoured immediately.

- **Refactor (no behaviour change):** extract the body of `TranscriptionHandlers.AnalyseNote` into a callable `INoteAnalysisService.AnalyseAsync(noteId, userId, workspaceId)` that takes owner/workspace explicitly (no `ICurrentUser`/`ICurrentWorkspace`/HTTP scope). The existing `POST /analyse` endpoint becomes a thin wrapper over it — its current Api.Integration tests stay green unchanged.
- **Frontend defer:** when diarization is auto-triggered (recording upload succeeded → diarize started), the on-Stop auto-analyse is **held** — the note is not analysed on the streamed transcript. (If the upload/diarize did not start, the on-Stop auto-analyse fires as today.)
- **Success path:** the completion Lambda, after appending `TranscriptionDiarized`, calls `INoteAnalysisService.AnalyseAsync` with owner/workspace from `history[0].Metadata` → one analyse on the diarized text.
- **Failure path (fallback):** on a FAILED job the completion Lambda calls `AnalyseAsync` on the **streamed** transcript, so a note whose auto-analyse was deferred is still analysed exactly once.
- Scenario: Given diarization was triggered (auto-analyse deferred), When the job COMPLETES, Then analysis runs once on the diarized transcript and `AnalysisSummaryRecorded` reflects it.
- Scenario: Given diarization was triggered (auto-analyse deferred), When the job FAILS, Then analysis runs once on the streamed transcript (fallback) — the note is never left un-analysed.
- Scenario: Given auto-analyse is OFF, When the user clicks Analyse, Then analysis runs immediately on the current transcript regardless of diarization state (manual is never deferred).
- Scenario: re-analysis failure does not roll back the transcript (the diarized transcript still shows; analysis error follows the existing path).
- **Acceptance:** exactly one analysis per recorded note — diarized on success, streamed on failure; no flicker; manual analyse always immediate; a Bedrock failure degrades gracefully (transcript intact).

**Observability (analysis timing + failures) — shipped ahead of B2 as [CHANGE-22](phase-minor-changes.md) (PR #325, deploy #625, 2026-06-23).** `IDomainMetrics.AnalysisCompleted(ms)`/`AnalysisFailed()` (EMF `AnalysisDurationMs`/`AnalysisFailed`, dimensionless), the per-note failure log, the `notetaker-analysis-failed` alarm and the "p50/p99 vs failures" widget already exist on the current `AnalyseNote` path. **B2 only needs to carry that instrumentation into the extracted `INoteAnalysisService.AnalyseAsync`** (it moves with the handler body) so the diarization-triggered re-analyse is covered too — no new metrics to design.

## Architecture notes

- **Audio source (33-A):** tee the existing 16 kHz mono PCM the streaming path already produces into a WAV buffer; upload on Stop. No second AudioContext, no 48 kHz/stereo (the spike's stereo was only for the offline comparison). Single presigned-PUT upload; **long-recording memory** handled later by multipart/chunked upload (noted, out of MVP scope).
- **Storage (33-A):** new `notetaker-recordings` S3 bucket, `RemovalPolicy.DESTROY`, **lifecycle expiry 7 days** (working artefact, not durable record). Least-privilege grant to the Command Lambda + presign capability.
- **Job lifecycle (33-B):** `POST /notes/{id}/transcription/diarize` (with the S3 key) → `transcribe:StartTranscriptionJob` (`ShowSpeakerLabels`, `MaxSpeakerLabels`, `en-GB`, output to the recordings bucket). **Completion is async via EventBridge** (Transcribe Job State Change rule → Command Lambda), not frontend polling — fetch result, parse speaker turns into `Speaker N:` text, append `TranscriptionDiarized`. Matches the production/operability goal; no held HTTP request.
- **Re-analysis (33-B):** `TranscriptionDiarized` handled like `TranscriptionCompleted` — Bedrock gap-fills content/tags/actions on the diarized transcript.
- **UX (33-B):** streamed transcript shows immediately on Stop (unchanged); a "Refining transcript with speaker labels…" chip appears while the job runs; on completion the transcript updates to the speaker-labelled version and analysis refreshes (note read returns the diarized text; frontend reflects it on the next note query / status poll).
- **Authorization:** the diarize endpoint and the EventBridge handler run on the **Command Lambda** (event-store access) and authorize ownership from the **event stream**, never an async projection (per the RYW/authz guardrails).

## Observability (silent failure modes)

| Failure | Make visible |
|---|---|
| Upload fails (network / presign expiry) | structured log + a frontend error toast; metric `recording.upload.failed` |
| Batch job fails / times out | EventBridge `FAILED` branch → log + metric `transcribe.batch.failed`; **alarm** on failures |
| EventBridge rule misfires / handler errors | log job id + note id on every transition; metric `transcribe.batch.completed` with duration |
| Parse error on the result JSON | log + fall back to keeping the streamed transcript (never blank the note) |
| Re-analysis fails | existing analysis error path; transcript still updated |

## Cost / deploy-time impact (flag before merge)

- **Deploy:** one-off infra add (S3 bucket, EventBridge rule, IAM grants, new Lambda handler/route) → a backend `cdk deploy`. **Recurring deploy-time delta: neutral** (no traffic-shifting/bake added).
- **Runtime cost:** Amazon Transcribe batch ≈ **$0.024/min** of audio per recording, plus negligible S3 for 7-day-expiring WAVs. One job per recording.

## Out of scope / future

- Cross-session speaker identity (matching "Speaker 1" across recordings) — not a goal (consistent with Phase 18-C).
- Naming speakers from calendar attendees — future feature.
- Multipart/streaming upload for very long meetings — future (MVP buffers + single upload).
- On-device/offline diarization (WhisperX/pyannote, NPU/QNN) — only if offline becomes a requirement; see the spike's `FINDINGS.md` (deleted with the spike) for the Mac/Snapdragon analysis.
