# Learnings: BUG-10 — live transcription fell progressively behind realtime

- **Streaming ASR from the browser must batch audio into ~100ms chunks; the Web Audio render quantum is a capture detail, not a transmission unit.** The hook posted one Transcribe `AudioEvent` per 128-sample worklet frame — ~8ms at 16kHz, so ~125 events/sec. Every event in the AWS event stream is serialised and SigV4-signed on the main thread, so ~125 signed frames/sec is more per-event overhead than the client can sustain: a backlog forms in the audio queue and, because Transcribe Streaming only *consumes* at ~realtime, it never drains — the transcript drifts further behind the longer the call runs. AWS guidance is ~100ms chunks; the client was ~12× too fine. **Action:** `PcmChunker` (`web/src/hooks/pcm.ts`) coalesces frames into fixed ~100ms PCM chunks (~10 events/sec) before they reach the SDK — Applied.

- **A realtime keep-pace defect is invisible to the whole test pyramid — only a real call surfaced it, and only a real call could confirm the fix.** All 287 component tests passed *with the bug present*: the AudioWorklet and the Transcribe SDK are both mocked, and there is no real audio, signing, or network over minutes. The defect manifests only under live conditions and accumulates over time. The lesson is that some performance/realtime properties are structurally unreachable below a real end-to-end run, so a manual "confirm on a real call" step is a genuine acceptance criterion, not a nicety. It was honestly left unchecked in the PR and the bug doc until verified. **Action:** acceptance criteria include the manual real-call check; verified working 2026-06-03 — Applied.

- **Diagnose the bottleneck before changing approach — the cheap in-architecture fix often exists.** The conversation had reached desktop-app and cloud-Whisper rewrites; the actual fix was a ~10-line client-side chunking change with no change in approach (still browser → AWS Transcribe Streaming). The decisive diagnostic that would have told us this without guessing is whether `audioQueue.length` grows over the call (client-side send backlog → batching helps) versus stays flat while the transcript still lags (server-side latency → approach change warranted). **Action:** the `audioQueue.length` diagnostic is recorded in the BUG-10 entry as the first step if it ever regresses — Applied.

- **In a long-lived streaming UI, a re-render whose cost grows with accumulated content is a latent congestion source.** Every partial result called `setTranscript` with the *entire* growing transcript string, so main-thread render cost rose with call length and competed with audio streaming on the same thread — compounding the chunking problem precisely as the call got longer. Throttling partial re-renders to ≤1 per 200ms (finals always render immediately, and never feed the saved transcript) bounds it. **Action:** partial-render throttle in `useTranscription.ts` — Applied.

- **Process: "tested but unreachable" is a real smell.** Review (Hawk) flagged `PcmChunker.flush()` — fully unit-tested but never called at the seam (the sub-100ms remainder at stop is intentionally dropped as negligible trailing audio). Carrying a tested-but-dead method invites a future reader to assume it matters. **Action:** removed `flush()`, documented the intentional drop on `push()`, and added an aliasing regression test instead — Applied.

## Applied status

| Learning | Status |
|---|---|
| 1. Batch streaming-ASR audio into ~100ms chunks; render quantum ≠ transmission unit | Applied — `PcmChunker`, ~125→~10 events/sec |
| 2. Realtime keep-pace is untestable below a real call; manual verification is a real acceptance step | Applied — verified on a real call 2026-06-03 |
| 3. Measure (`audioQueue.length`) before re-architecting; the in-architecture fix existed | Applied — diagnostic recorded for any regression |
| 4. Re-render cost that grows with accumulated content congests a long streaming session | Applied — partial-render throttle (≤1/200ms) |
| 5. Remove tested-but-unreachable code rather than carry it | Applied — `flush()` dropped, aliasing test added |
