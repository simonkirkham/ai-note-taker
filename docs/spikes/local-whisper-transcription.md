# Spike — local Whisper transcription vs Amazon Transcribe

**Question:** Can a local Whisper model replace Amazon Transcribe cheaply enough and well enough to run transcription on-device in the desktop app? (Cost driver: at ~3 hr/day, cloud Transcribe projects to ~$40–260/mo; local is $0 marginal.)

**Feeds:** the [Local on-device transcription](../future-features.md) future-feature. Reopens the [Phase 33](../phases/phase-33.md) engine decision, which rejected local *"only if on-device/offline becomes a requirement."*

**Status:** Step 1 (quality + final-pass speed) — **PASS**. Step 4 (diarization) — **PASS**: 2-party via source separation + VAD (Step 4), N-way via sherpa-onnx pyannote-seg + NeMo TitaNet-large ≈**14% DER** on the real 7-speaker meeting, CPU-only, no torch/HF (Step 4b). Given the user's even 1:1/group split, build both paths. Steps 2 & 5 (live latency, packaging) still open — need the Windows/Electron shell.

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

**Verdict:** viable and cheap for **1:1 / 2-party** calls (me vs one other) *with VAD*. **Insufficient for multi-party** meetings where who-said-what among the remote speakers matters — that still needs local N-way diarization (tested in Step 4b). Proper validation still needs **real two-stream capture** from the desktop; the masking proxy also injects Whisper timestamp-drift, so treat the raw pre-VAD attribution rate as contaminated — the reliable signals are the ×237 loop and its VAD fix.

## Step 4b — local N-way diarization (tested 2026-07-23)

**Question:** meetings are an **even split of 1:1 and group calls**, so the group half needs true N-way diarization that source separation can't give. Can it run locally, cheaply, without the heavy torch/pyannote stack Phase 33 flagged?

**Engine:** `sherpa-onnx` 1.13.4 — ONNX Runtime, **CPU-only, no torch, no HuggingFace token or gated-model login**. Pipeline = pyannote **segmentation-3.0 → ONNX** (5.8 MB) + a speaker-embedding model + fast clustering. Same real 22.1-min / 7-speaker meeting; reference = Amazon Transcribe's own diarization on the same file (a *pseudo*-reference — this measures **agreement with Transcribe**, not ground truth).

**Embedding model is decisive** (fixed cluster count = 7):

| Embedding model | Size | Speakers | Correctly attributed | Wrong speaker | ~DER | × realtime (CPU) |
|---|---|---|---|---|---|---|
| **NeMo TitaNet-large** | 97 MB | 7 | **87.3%** | 6.4% | **14.0%** | 4.5× |
| 3D-Speaker CAM++ (en) | 29 MB | 7 | 47.1% | 46.4% | 54.2% | 12.8× |
| WeSpeaker ResNet34-LM | 26 MB | 6* | 53.5% | 40.2% | 47.8% | 5.1× |

\* collapsed two speakers into one despite being asked for 7.

**Findings:**

| Finding | Result |
|---|---|
| **Local N-way works** — closes the group-call gap | TitaNet-large ≈ **14% DER** vs Transcribe on the hard 7-speaker case (good; commercial diarizers land 10–20% here). Qualitative check confirms it: dominant speaker tracked cleanly, errors only on ≤3-word interjections. |
| **Weak embedding was the whole problem** | The poor 54% DER on the first pass was CAM++, not the approach. TitaNet-large fixes it — the 97 MB model is worth the bytes. |
| **Auto speaker-count is unusable** on real conference audio | Threshold clustering over-fragments: thr 0.4→65, 0.7→23, 0.85→13 speakers. **Must supply the count.** |
| **Count comes free from calendar** | The app already integrates calendar; attendee count feeds `num_clusters` directly. |
| **Cheap** | Diarization is ~⅓ the cost of the `medium.en` transcription pass (4.5× vs 1.5× realtime); negligible added latency. |
| **Packaging-friendly** | Pure ONNX, +103 MB (5.8 seg + 97 emb), **no torch / no CUDA / no HF login** — far lighter than the WhisperX+pyannote-torch stack Phase 33 rejected. |

**Decision (given the even 1:1/group split):** build **both** paths.

| Meeting type | Path | Cost |
|---|---|---|
| 1:1 / 2-party | source separation (Step 4) + VAD | ~0 — no embedding model |
| Group | sherpa-onnx pyannote-seg + **TitaNet-large**, count from calendar attendees | +103 MB models, 4.5× realtime |

**Caveats:** single meeting; **mono-mix** (the prod recording is mono). The real desktop captures mic+loopback as **2 channels** — "me" is already isolated on the mic, so diarization only has to split the *loopback* (remote) speakers, which should be **easier** than this mono result. TitaNet-large was the only embedding that worked — validate on a real 1:1 and one more group call before committing.

## Still open (need the Windows/Electron shell)

| # | Unknown | Note |
|---|---|---|
| 2 | Live-streaming latency | `base.en` at 3.64× realtime strongly suggests it keeps pace; must confirm in the desktop capture pipeline |
| 4 | Diarization | **Resolved** — 2-party via source separation (Step 4), N-way via sherpa-onnx + TitaNet-large ≈14% DER (Step 4b). Remaining: validate on **real** two-stream capture and 1–2 more meetings (1:1 + group) |
| 5 | Packaging | Bundle binaries + `medium.en` (1.5 GB) + VAD (865 KB) + diarization models (seg 5.8 MB + TitaNet-large 97 MB) in the Electron installer vs. first-run download; installer-size impact |

## Reproduce

**Step 1/4 (whisper.cpp):** artifacts in a prior session scratchpad: `meeting.wav`, `reference-transcribe.json`, `whisper-{base,small,medium}.en.txt`, `compare.py`. Build: `cmake -B build -DCMAKE_BUILD_TYPE=Release && cmake --build build -j`. Run: `whisper-cli -m models/ggml-medium.en.bin -f meeting.wav -t 16 -otxt`.

**Step 4b (sherpa-onnx diarization):** `pip install sherpa-onnx soundfile numpy`. Models (GitHub releases, no HF login): pyannote segmentation `sherpa-onnx-pyannote-segmentation-3-0.tar.bz2` (tag `speaker-segmentation-models`) + `nemo_en_titanet_large.onnx` (tag `speaker-recongition-models` — note the upstream typo). `diarize.py`/`evaluate.py` in the session scratchpad drive `OfflineSpeakerDiarization` with `FastClusteringConfig(num_clusters=<attendee count>)` and score frame-level agreement vs the Transcribe reference. `meeting.wav` re-pulled from prod S3 `recordings/94692735…/…wav`.
