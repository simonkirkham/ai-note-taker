# Phase 33 — Higher-quality speaker-labelled transcripts via Amazon Transcribe batch

**Goal:** After a recording stops, produce a **cleaner, speaker-diarized transcript** than live streaming gives, by running an **Amazon Transcribe batch** job (`ShowSpeakerLabels`) over the captured audio and replacing the streamed transcript with the diarized result (then re-analysing). Live streaming stays for the in-call experience; batch is a **post-call refinement** that coexists with it — never a big-bang cutover.

## Summary

| Slice | Summary | Status | Depends on |
|-------|---------|--------|------------|
| 33-A | **Save the call recording.** Tee the live 16 kHz mono PCM into a WAV; on Stop, upload it to a new `notetaker-recordings` S3 bucket (presigned PUT, 7-day lifecycle expiry). Exposes a "Download recording" link on the note. Standalone value (audio safety net) + the audio-retention contract 33-B consumes. | Not Started | — |
| 33-B | **Diarized transcript replaces the streamed one.** New endpoint starts a Transcribe **batch** job (`ShowSpeakerLabels`) on the uploaded audio; job completion (EventBridge → Command Lambda) parses speaker turns → new `TranscriptionDiarized` event → transcript replaced + analysis re-runs. UX: a "Refining transcript…" indicator that resolves to the speaker-labelled transcript. | Not Started | 33-A |

> **Slice order.** 33-A ships the genuinely new infra (audio retention + S3 upload) and is independently shippable/verifiable (the recording appears in S3 and is downloadable). 33-B adds the async batch lifecycle on top. The cross-cutting contract to prove first is the **async job → event → re-analysis** path (33-B); 33-A de-risks it by isolating audio upload.

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

- **New event `TranscriptionDiarized` (v1)** on the Note aggregate: `{ Text, SpeakerCount, JobId, SourceAudioKey }`. Latest-wins over `TranscriptionCompleted` for the note's transcript; re-triggers Bedrock analysis exactly like `TranscriptionCompleted`. New deserializer arm; `NoteDetailProjection` folds it into `TranscriptText`.
- No change to `TranscriptionCompleted` (immutable). Streaming still appends it; the diarized event supersedes it when the batch lands.

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
