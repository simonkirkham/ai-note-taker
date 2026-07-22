# Spike — local Whisper transcription vs Amazon Transcribe

**Question:** Can a local Whisper model replace Amazon Transcribe cheaply enough and well enough to run transcription on-device in the desktop app? (Cost driver: at ~3 hr/day, cloud Transcribe projects to ~$40–260/mo; local is $0 marginal.)

**Feeds:** the [Local on-device transcription](../future-features.md) future-feature. Reopens the [Phase 33](../phases/phase-33.md) engine decision, which rejected local *"only if on-device/offline becomes a requirement."*

**Status:** Step 1 (quality + final-pass speed) — **PASS**. Step 4 (diarization by source separation) — **PARTIAL**: clean for 2-party with VAD, but only ever 2 labels. Steps 2 & 5 (live latency, packaging) still open — need the Windows/Electron shell.

---

## Method (Step 1)

| | |
|---|---|
| Test audio | One **real** 22.1-min meeting pulled from prod S3 (`recordings/{noteId}/*.wav`), 16 kHz mono 16-bit PCM — whisper.cpp's native format, no conversion |
| Reference | Amazon Transcribe's own output for the same audio (3,317 words) — a *pseudo*-reference (itself imperfect), not ground truth |
| Engine | `whisper.cpp` built from source, **CPU-only, no GPU** (16 cores) — a conservative floor vs. a real GPU/Apple-Silicon desktop |
| Models | `base.en` (142 MB), `small.en` (466 MB), `medium.en` (1.5 GB) |
| Metric | Word-level WER vs. Transcribe (+ a filler-word-stripped WER) and a qualitative side-by-side |

## Results

| Model | Wall (22.1-min file) | **× realtime (CPU)** | WER vs AWS | WER (no filler) |
|---|---|---|---|---|
| base.en | 364 s | **3.64×** | 22.2% | 20.5% |
| small.en | 568 s | **2.34×** | 18.7% | 16.0% |
| medium.en | 864 s | **1.54×** | 13.4% | 12.1% |

## Findings

1. **Speed — PASS even without a GPU.** Every model runs **faster than realtime** on a plain CPU; `medium.en` at 1.54× means a 1-hr meeting transcribes in ~39 min. A GPU/Apple-Silicon desktop would be multiples faster. The "final pass ≤ recording length" criterion is met with headroom.
2. **Quality — competitive with Amazon Transcribe.** `medium.en` agrees ~88% with Transcribe. The ~12% divergence is dominated by **filler-word removal and punctuation, not meaning**. On the opening passage, local caught every proper noun and technical term Transcribe did (GYC, Kate, core extract, contract, 12 months, roll back) and read *cleaner* (no "um, uh"). This directly contradicts Phase 33's "no clear quality win" — that verdict was on `WhisperX-small`+pyannote, not `medium.en`.
3. **Model choice.** `medium.en` is the final-quality pick; `base.en`/`small.en` (3.6×/2.3× realtime) are live-streaming candidates.

## Step 4 — diarization by source separation (tested 2026-07-22)

**Idea:** the desktop captures mic (me) and loopback (everyone else) as separate streams, so transcribing each separately and interleaving by timestamp yields speaker labels with **no ML diarization**.

**Method:** the real meeting is mixed mono, so simulated two streams by masking the audio to per-speaker regions from the Transcribe reference (dominant speaker `spk_4` = "me", other 6 = "them"), transcribed each with `small.en`, merged by timestamp.

**Findings:**

| Finding | Result |
|---|---|
| Merge pipeline (interleave two timestamped transcripts → `Me:/Them:`) | **Works, trivial** |
| **Hallucination on silence** — each stream is ~50–65% silence (the other party's turns); Whisper fills it with repeated fabricated phrases | **Severe without VAD** — the "them" stream repeated one sentence **×237** (60% of segments were duplicate hallucinations) |
| **VAD fixes it** (`whisper.cpp --vad` + silero model, 865 KB) — strips non-speech before transcribing | Duplicate loops **60% → 1%**; output clean and on-content. **VAD is mandatory, not optional.** |
| **Speaker-count ceiling** | This meeting had **7 speakers**; source separation collapses the 6 remote participants into a single merged "Them". It gives **Me vs Them only** — it cannot separate the far side. |

**Verdict:** viable and cheap for **1:1 / 2-party** calls (me vs one other) *with VAD*. **Insufficient for multi-party** meetings where who-said-what among the remote speakers matters — that still needs local WhisperX/pyannote N-way (the heavy stack Phase 33 flagged). Which path to build depends on the user's real meeting profile (1:1 vs group). Proper validation still needs **real two-stream capture** from the desktop; the masking proxy also injects Whisper timestamp-drift, so treat the raw pre-VAD attribution rate as contaminated — the reliable signals are the ×237 loop and its VAD fix.

## Still open (need the Windows/Electron shell)

| # | Unknown | Note |
|---|---|---|
| 2 | Live-streaming latency | `base.en` at 3.64× realtime strongly suggests it keeps pace; must confirm in the desktop capture pipeline |
| 4 | Diarization | Tested above — 2-party works with VAD; multi-party needs pyannote. Remaining: validate on **real** two-stream capture, and decide 1:1-only vs. full N-way based on meeting profile |
| 5 | Packaging | Bundle binary + `medium.en` (1.5 GB) + VAD model in the Electron installer vs. first-run download; installer-size impact |

## Reproduce

Artifacts in the session scratchpad (`spike/`): `meeting.wav`, `reference-transcribe.json`, `whisper-{base,small,medium}.en.txt`, `compare.py`, `RESULTS.txt`. Build: `cmake -B build -DCMAKE_BUILD_TYPE=Release && cmake --build build -j`. Run: `whisper-cli -m models/ggml-medium.en.bin -f meeting.wav -t 16 -otxt`.
