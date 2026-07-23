# Phase 48 — Local on-device transcription & diarization _(In Progress — 48-A, 48-B, 48-C done 2026-07-23)_

**Goal:** Record a meeting in the desktop app and get the live transcript, the final transcript, and speaker labels produced entirely on your machine — no per-minute cloud transcription or diarization cost.

## Summary

| Slice | What the user gets | Status | Depends on |
|-------|--------------------|--------|------------|
| 48-A | A desktop setting to transcribe locally; recording shows a live transcript with no cloud transcription cost | Done _(#400, deploy #703; installer `desktop-latest`)_ | — |
| 48-B | The saved transcript is upgraded to higher quality on stop | Done _(#401, deploy 213d8f3c)_ | 48-A |
| 48-C | 1:1 calls show who said what (me vs. the other person), computed on-device | Done _(#402, deploy 0e8f4645)_ | 48-A |
| 48-D | Group calls show who said what across all remote speakers, computed on-device | Not Started | 48-C |
| 48-E | A setting to keep meeting audio fully on your machine (no upload) | Not Started | 48-A |

Ordering: 48-A proves the whole capture→local-engine→live-transcript→saved-note flow on one real call (and answers the live-latency unknown); 48-B/C/D scale it — better final quality, then 1:1 labels, then group labels; 48-E is the privacy setting and is independent of the diarization slices. Models download in the background on first app launch (below the divider); a slice is unavailable until its model is present, with cloud transcription as the fallback.

## Slices

<!-- REVIEW SURFACE — the human reads this and stops. No technical artefact named below. -->

### Slice 48-A — Live local transcription (on/off setting)

- **User value:** Transcribe meetings with zero per-minute cost, entirely on the machine — the single biggest cloud bill goes to $0.
- **How it works:**
  - A setting in the desktop app: **Transcription — Local (on device) / Cloud**. Cloud stays the default until local is proven.
  - With Local on, clicking record captures mic + system audio as today, but the live transcript is produced by an on-device model instead of the cloud.
  - The live transcript appears in the same place, updating as you speak.
  - On stop the transcript saves to the note exactly as it does today (analysis, summary, action items all unchanged).
  - Local mode is only offered once the on-device model has finished its one-time background download; until then the setting shows "Preparing… (downloading models)" and recording uses cloud.
  - If the local engine fails mid-recording, the app surfaces it and the recording falls back to cloud — never a silent empty transcript.
- **Scenarios (GWT):**

```
Scenario: Record with local transcription
  Given the on-device model is downloaded and I set Transcription to Local
  When  I record a meeting and speak
  Then  a live transcript appears on-device with no cloud transcription request

Scenario: Local not yet ready
  Given the on-device model is still downloading
  When  I open the transcription setting
  Then  Local shows "Preparing…" and recording uses cloud

Scenario: Local engine fails mid-recording
  Given I am recording with Local transcription
  When  the on-device engine fails to start or crashes
  Then  the app surfaces the failure and continues the recording via cloud, with no empty transcript

Scenario: Cloud unchanged
  Given I leave Transcription set to Cloud
  When  I record a meeting
  Then  behaviour is identical to today (no regression)
```

### Slice 48-B — Higher-quality final transcript on stop

- **User value:** The saved transcript reads more accurately than the fast live view — proper nouns and technical terms are correct.
- **How it works:**
  - The live transcript uses a fast, lighter model (kept responsive).
  - On stop, the app re-transcribes the recording once with a higher-quality model and saves that as the note's transcript.
  - A brief "Finalising transcript…" state shows while the better pass runs; the note then settles on the higher-quality text.
  - The final pass completes in less time than the meeting lasted (on the author's machine).
- **Scenarios (GWT):**

```
Scenario: Final pass upgrades the transcript
  Given I recorded a meeting with local transcription
  When  I stop
  Then  a higher-quality transcript replaces the live text on the saved note

Scenario: Final pass keeps up
  Given a recording of length N
  When  the final pass runs on stop
  Then  it finishes in less than N and the note is not left in "Finalising" indefinitely
```

### Slice 48-C — 1:1 calls: who said what (on-device)

- **User value:** For a two-person call, the transcript is labelled "Me" / the other participant, without any cloud diarization cost.
- **How it works:**
  - The desktop already captures "me" (mic) and "them" (system audio) as distinct sources.
  - On stop, each source is transcribed separately and interleaved by time into a labelled transcript (`Me:` / `Them:`).
  - Silence in each source is stripped first so the quiet side doesn't produce fabricated text.
  - The labelled transcript feeds the note's analysis exactly as diarized cloud transcripts do today.
- **Scenarios (GWT):**

```
Scenario: Two-party transcript is labelled
  Given a 1:1 meeting recorded with local transcription
  When  I stop
  Then  the saved transcript attributes each turn to "Me" or the other participant

Scenario: No fabricated text on the quiet side
  Given long stretches where only one person talks
  When  the labelled transcript is produced
  Then  the silent side contributes no invented/repeated text
```

### Slice 48-D — Group calls: who said what across remote speakers (on-device)

- **User value:** For a multi-person call, the transcript separates each remote speaker (not just "me vs. them"), computed on the machine.
- **How it works:**
  - For calls with more than two people, the remote (system-audio) side is split into individual speakers on-device.
  - The number of speakers to expect is taken from the meeting's calendar attendees, which makes the split reliable.
  - The result is merged with "me" into a per-speaker labelled transcript and saved to the note.
  - Falls back to the 1:1 "me vs. them" labelling if attendee information isn't available.
- **Scenarios (GWT):**

```
Scenario: Group transcript separates remote speakers
  Given a meeting with several attendees recorded with local transcription
  When  I stop
  Then  the saved transcript attributes turns to distinct remote speakers, plus "Me"

Scenario: Falls back without attendee data
  Given a group meeting with no calendar attendee list available
  When  the labelled transcript is produced
  Then  it degrades to "Me" vs. "Them" rather than failing
```

### Slice 48-E — Keep meeting audio on-device (setting)

- **User value:** Choose that raw meeting audio never leaves the machine — only the transcript is stored in the cloud.
- **How it works:**
  - A setting: **Keep recordings on this device only** (default on — privacy-first).
  - With it on, a locally-transcribed meeting uploads no audio; the note still saves its transcript, summary, and action items.
  - With it off, audio uploads as today (re-download and future re-analysis remain available).
  - The setting only affects local-mode recordings; cloud transcription still needs the upload and ignores this setting.
- **Scenarios (GWT):**

```
Scenario: Audio stays on-device
  Given "Keep recordings on this device only" is on and Transcription is Local
  When  I record and stop
  Then  no audio is uploaded and the note still has its transcript and analysis

Scenario: Opt back into upload
  Given the setting is off
  When  I record locally and stop
  Then  the audio uploads as today and the recording is downloadable
```

---

## Build notes _(implementation — skip when reviewing)_

**Framing:** graduates the *Local on-device transcription* future-feature into a numbered phase. The desktop shell already exists (**[Phase 31](phase-31.md)**) and captures mic+loopback. Spike **[docs/spikes/local-whisper-transcription.md](../spikes/local-whisper-transcription.md)** has cleared the go/no-go: Step 1 quality PASS, Step 3 final-pass speed PASS, Step 4 2-party diarization PASS, Step 4b N-way diarization PASS (~14% DER, sherpa-onnx + TitaNet-large). The two open unknowns this phase closes are Step 2 (live latency in the shell) and Step 5 (packaging).

### Architecture (shared across slices)

- **Engines run in the Electron main process** (Node), not the renderer: main spawns the `whisper.cpp` CLI as a child process and runs on-device diarization; the renderer streams captured PCM to main over a new IPC channel and receives transcript partials/finals back. `desktop/src/preload.ts` currently exposes only `{ isDesktop, platform }` — add a minimal, typed IPC surface (`startLocalTranscription`, `pushPcm`, `onPartial/onFinal`, `finalizeLocal`) with `contextIsolation` preserved.
- **Renderer integration point:** `web/src/hooks/useTranscription.ts`. Today it streams PCM to AWS Transcribe (creds from `getTranscriptionCredentials`), assembles finals into `finalizedRef`, autosaves a draft (`saveTranscriptionDraft`), commits `TranscriptionCompleted` on stop (`completeTranscription`), uploads the WAV (`presignRecordingUpload`+`saveRecording`), and triggers server batch diarization (`startDiarization`). Local mode swaps the **STT source** and the **diarization source** only; the draft/commit/analysis path is reused unchanged.
- **Feature-detect** via `window.desktop?.isDesktop`; the setting and all local paths are desktop-only. The **web app keeps cloud Transcribe** — no browser-side model (Phase 31 scope boundary carries over).
- **Aim: zero backend / CDK / event-model change.** The locally-produced (and locally-diarized) transcript is committed through the existing `TranscriptionCompleted` path; local mode simply does **not** call `startDiarization` (it commits already-diarized text). Confirm in Breaker that the commit path accepts pre-diarized text with speaker labels without a server round-trip; if a flag is needed it is a request-shape addition only.
- **Diarization is a stop-time (batch) operation** — the on-device diarizer needs the whole recording, so live is undiarized rolling text and speaker labels are applied in the final pass. This is a design fact that shapes B/C/D (all operate on stop).
- **Model provisioning — background download on first launch.** On first app open, main fetches the model set once into app-data (`app.getPath('userData')/models`) with a progress indicator; cached forever after. A slice's local path is unavailable until its model is present; the setting shows "Preparing…" and recording falls back to cloud. Installer stays ~82 MB (no models bundled). Host the models on a controlled URL (e.g. the app's GitHub Releases or an S3 prefix) with a checksum manifest; verify checksums before use.
- **Cloud fallback is a first-class path,** not an error state: local-engine failure to start, crash mid-recording, or model-not-ready all continue the recording via the existing cloud streaming path. Never a silent empty transcript (mirrors Phase 31-B's guard against silent mic-only capture).

### Per-slice

**48-A — Live local transcription** _(Done — #400, deploy #703, installer built + published to `desktop-latest` via `publish-desktop` dispatch)_
- **As shipped:** whisper-cli **binary bundled** in the installer (fetched per-platform at package time by `desktop/scripts/fetch-whisper-bin.mjs`, sha256-verified; x64 installer 82→88 MB); the `base.en` **weights download in the background on first local-mode selection** (not launch — cloud-only users never pull them), sha256-verified, cached in `%APPDATA%/…/models`. Engine runs in the Electron main process (`localTranscription.ts` spawns whisper-cli per 5 s PCM window); pure modules (`whisperParse`, `localEngine.PcmWindower`, `models`) unit-tested; the spawn proven against a real binary in `localTranscription.integration.spec.ts` (env-gated, CI-skipped).
- **Live model = `base.en`** (shipped); confirm base-vs-small against real Windows latency during the manual check.
- **Still pending (manual-on-Windows, `MANUAL-VERIFICATION.md §48-A`):** live latency keeps pace (Step 2), real capture produces on-device transcript with no cloud STT request, tail flushed on stop. Automated coverage: desktop tsc + specs, web tsc/lint/vitest all green in CI.
- **arm64 gap:** `fetch-whisper-bin.mjs` provisions only the x64 whisper binary; the arm64 installer bundles it too, so on arm64 Windows the spawn fails → clean cloud fallback (local unavailable). Fine for now; provision an arm64 binary if arm64 becomes a target.
- Original plan: Bundle/download `whisper.cpp` binary (Windows) + a live model (`base.en` ≈3.6× realtime, or `small.en` ≈2.3× — pick during the slice against real live-latency on the target Windows machine; Step 2).
- IPC: renderer tees the existing 16-bit PCM chunks (already buffered at `useTranscription.ts` for the WAV) to main; main feeds whisper streaming; partials/finals returned and merged into `finalizedRef` via the existing coalescing logic.
- Setting persisted in renderer local state/localStorage; default **Cloud**.
- ACs: local partials appear with no cloud STT request (assert no `getTranscriptionCredentials`/Transcribe socket); cloud path byte-identical when setting=Cloud; engine-failure falls back to cloud; model-not-ready hides Local. Live-latency AC (partials keep pace, no growing lag) is **manual-on-Windows** (`desktop/MANUAL-VERIFICATION.md`), like Phase 31's real-capture checks.

**48-B — Final-quality pass** _(Done — #401, deploy 213d8f3c; installer auto-rebuilt by publish-desktop)_
- **As shipped:** on stop the session re-transcribes the whole retained recording with `medium.en` (role `final`); `local:finish` returns the transcript, the renderer applies it before commit behind a transient `'finalising'` status. Best-effort: `medium.en` (1.5 GB) downloads after `base.en` (readiness gates on live only), and the final pass is skipped (live text kept) if it isn't present. Wall-clock timeout on the whisper child (scaled to audio length) prevents an indefinite "Finalising". Audio uploads before the final pass so a crash can't lose it.
- **`'finalising'` is treated as an active session** everywhere in NoteView (hasContent/Save, back-trap, live transcript) + the beforeunload/keepalive guard — the multi-minute window must not let a fresh note be Cancel-deleted or the transcript blank (Hawk critical, guarded by `NoteViewFinalising.test.tsx`).
- **Still pending (manual-on-Windows, `MANUAL-VERIFICATION.md §48-B`):** real `medium.en` quality uplift + final-pass latency (final ≤ recording length) + graceful degrade when `medium.en` not yet downloaded.
- Original plan: On stop, main re-runs whisper with `medium.en` over the full captured audio; result replaces the live text before `completeTranscription`. "Finalising transcript…" transient state.

**48-C — 2-party diarization (source separation + VAD)** _(Done — #402, deploy 0e8f4645; installer auto-rebuilt)_
- **As shipped:** two extra AudioWorklets tap the mic + loopback sources separately (only in confirmed-local + call-audio mode); on stop the buffers go to `local:diarize`, which VAD-transcribes each (silero, role `vad`) with the final model and interleaves (`diarizeMerge`, pure) into `Me:`/`Them:`. `local:discard` drops the live session's single-stream final pass when diarization produced the transcript. Engine proven vs the real binary + VAD.
- **Local mode now skips cloud diarization for ALL recordings** (`uploadRecording(triggerCloudDiarization=false)`): the on-device transcript is committed and no longer overwritten by the Amazon Transcribe batch — this **unmasks 48-B** and removes the cloud diarization cost/error. **Motivated by real-call feedback:** the user's 1:1 showed 3 speakers because cloud diarization still ran; source separation is structurally exactly 2 (two physical channels).
- **Product decision (explicit):** mic-only local commits the single-stream transcript with no diarization (one-speaker assumption). In-person multi-speaker on a single mic loses diarization — a future N-way-on-mic case (48-D covers group *calls* via the loopback). Cloud path + the mixed live view untouched.
- **Still pending (manual-on-Windows, `MANUAL-VERIFICATION.md §48-C`):** exactly-2-speakers on a real 1:1, no `…/diarize` request, attribution quality, quiet-side no-fabrication, VAD-missing + mic-only fallbacks.
- Original plan: capture mic/loopback separately; `whisper.cpp --vad` per stream; interleave → `Me:`/`Them:`; skip `startDiarization`.

**48-D — N-way diarization (sherpa-onnx + TitaNet-large)**
- Route by attendee count (from the note's calendar meeting link): ≤2 → 48-C source separation; >2 → run `sherpa-onnx` `OfflineSpeakerDiarization` (pyannote **segmentation-3.0 ONNX** 5.8 MB + **NeMo TitaNet-large** 97 MB) on the **loopback** stream with `FastClusteringConfig(num_clusters=<remote attendee count>)`, merge with mic="Me".
- Diarize the loopback (remote) side only — "me" is already isolated on the mic, which is easier than the mono spike (~14% DER) and avoids mislabelling me.
- Engine binding: sherpa-onnx C API / prebuilt Node addon in main (no torch, no HF login — spike-confirmed). Fall back to 48-C labelling when attendee count is unavailable.
- AC: >2-attendee transcript separates remote speakers (manual-Windows against a real group call); fallback to Me/Them without attendee data (unit-testable routing).

**48-E — Keep-audio-on-device setting**
- Setting (default **on**) gates the `presignRecordingUpload`+`saveRecording` calls for **local-mode** recordings only; transcript commit + analysis unaffected. Cloud mode ignores the setting (upload still required).
- AC: setting on + local → no upload, note still complete; setting off → uploads as today; cloud mode unaffected.

### Observability
- No CloudWatch reach into the client — surface to the renderer console / in-app at minimum (Phase 31 pattern).
- Silent failure modes to guard: local engine spawn/crash → falls back to cloud (log the reason + which model); model download stalls/corrupt → checksum-fail surfaces, Local stays "Preparing…"; diarization produces wrong speaker count → log requested-vs-produced (spike showed clustering can collapse counts); final pass exceeds recording length → timeout + surface.
- Stamp the bundled/downloaded model versions and log them on record start (bundle-drift analogue).

### Deploy-time
- **Neutral on the prod pipeline** (Phase 31 precedent): all work is under `desktop/` + a desktop-only setting in `web/`; the desktop installer is built by the existing separate `publish-desktop.yml` (Windows runner, post-deploy, changed-paths-gated) and does **not** run in `deploy.yml` or `cdk deploy`. Model download is at app runtime, not build. State the desktop-build time delta if `medium.en`/diarization models are ever bundled into the installer instead of downloaded (they are not, per the decision above).

### Open decisions (lock at review)
- **Live model:** `base.en` vs `small.en` — decide on real Windows live-latency (Step 2) in 48-A.
- **Diarize-both-sides vs loopback-only:** default loopback-only (48-D); revisit only if "me" mislabels.
- **Model host:** GitHub Releases vs an S3 prefix for the first-run download + checksum manifest.
