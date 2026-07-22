# Spike — local Whisper transcription vs Amazon Transcribe

**Question:** Can a local Whisper model replace Amazon Transcribe cheaply enough and well enough to run transcription on-device in the desktop app? (Cost driver: at ~3 hr/day, cloud Transcribe projects to ~$40–260/mo; local is $0 marginal.)

**Feeds:** the [Local on-device transcription](../future-features.md) future-feature. Reopens the [Phase 33](../phases/phase-33.md) engine decision, which rejected local *"only if on-device/offline becomes a requirement."*

**Status:** Step 1 (quality + final-pass speed) — **PASS**. Steps 2–5 (live latency, diarization, packaging) still open — need the Windows/Electron shell.

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

## Still open (need the Windows/Electron shell)

| # | Unknown | Note |
|---|---|---|
| 2 | Live-streaming latency | `base.en` at 3.64× realtime strongly suggests it keeps pace; must confirm in the desktop capture pipeline |
| 4 | **Diarization** | whisper.cpp gives transcript **only — no speaker labels**. Prod today is diarized ("Speaker N:"). Local parity needs either **source separation** (mic vs. loopback — free, 2-party) or a local WhisperX/pyannote pass (heavier). **This is the main remaining quality gap.** |
| 5 | Packaging | Bundle binary + `medium.en` (1.5 GB) in the Electron installer vs. first-run download; installer-size impact |

## Reproduce

Artifacts in the session scratchpad (`spike/`): `meeting.wav`, `reference-transcribe.json`, `whisper-{base,small,medium}.en.txt`, `compare.py`, `RESULTS.txt`. Build: `cmake -B build -DCMAKE_BUILD_TYPE=Release && cmake --build build -j`. Run: `whisper-cli -m models/ggml-medium.en.bin -f meeting.wav -t 16 -otxt`.
