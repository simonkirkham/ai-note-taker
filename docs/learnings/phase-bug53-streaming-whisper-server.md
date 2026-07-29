# BUG-53 — low-latency local transcription via a resident whisper-server

**Slice:** BUG-53 (Step 2 of the local-transcription latency fix). Merged #413, deploy `a98c0d9b` / run #715.

**What shipped:** replaced the spawn-per-window `whisper-cli` live path (reloaded the model every 5 s window → 5-7 s latency + CPU churn) with a resident `whisper-server` (model loaded once, `/inference` over HTTP) + a pure sliding-window reducer that folds overlapping re-transcriptions into a growing transcript (~3-4 s perceived latency).

## Non-obvious lessons

1. **De-risk a native dependency on real hardware before building the slice around it.** The user chose "native binding" (`smart-whisper`) for Step 2. A throwaway spike measured it at **0.18× realtime** for small.en — 15× too slow — because the prebuilt native addon ships **without whisper.cpp's runtime CPU-feature dispatch** (the AVX/AVX2/… variant selection). The official `whisper-server` binary keeps that dispatch, so it's fast *and* portable. Had we built the whole slice on the binding first, we'd have discovered the dead-end at integration. The spike cost ~1 session and saved the slice. Recorded in `docs/spikes/local-whisper-transcription.md`.

2. **Swapping an engine silently orphans the old failure-signalling path — audit every consumer, not just the happy path.** The old `LocalTranscriptionSession` emitted `local:error` on a failed pass; the renderer had a banner wired to it. The new `StreamingSession` only `console.error`'d in main, so **nothing emitted `local:error` anymore** — the banner became unreachable (grep-confirmed zero emitters). Worst case: server fails to start + no `small.en` final model + keep-audio-local on → empty transcript, PCM freed, meeting lost, **zero signal**. This is the same class of bug as the read-after-write authz misses (BUG-30): *when you replace a component, the half-wired contract from the old one is a lie until you re-check every consumer.* Hawk caught it; the fix reconnected `local:error` from three paths (start-failure, sustained streaming-failure threshold, mid-recording crash).

3. **A resident long-lived child needs the same three-point kill lifecycle as the per-window children — plus a hang timeout the CLI path already had.** `whisper-server` is killed on new-recording start, on discard/stop-as-warm-keep, and on `app.before-quit` (BUG-52's `killActiveWhisper` pattern, extended with `killWhisperServer`). The CLI path had a length-scaled spawn timeout; the HTTP path had none → a server that accepts the connection but never responds would wedge the busy-guard forever. Fixed with `AbortSignal.timeout` on `/inference`.

4. **A sliding-window reducer that commits on a *settled boundary* can never advance if the boundary never settles.** Continuous speech can return as one segment spanning the whole window; its `endMs` never falls before the stability edge, so nothing commits, `finalizedMs` never advances, and the re-transcribe window grows every step until inference can't keep pace. Needs an explicit `hardWindowMs` runaway guard that force-commits and advances regardless. A "bounds the cost" comment that only holds *when a boundary settles* is not a bound.

## Process notes

- Desktop specs are **not** in the PR CI gate (only `publish-desktop.yml` packages the installer, on the Deploy-success `workflow_run`), so the live path is proven by (a) headless unit tests of the pure reducer + parser, (b) an env-gated real-binary integration spec, and (c) a manual Windows checklist (MANUAL-VERIFICATION §BUG-53). Don't rely on CI to catch a desktop regression.
- The 5 `server.spec`/`shell.e2e` desktop failures in a local WSL run are environmental (no built `web-dist`, Electron can't launch headless) — not a regression signal.
