// 48-A / BUG-53 — pure engine helpers (no electron, no child_process), unit-tested headlessly.
// The whisper spawns live in localTranscription.ts (batch) + whisperServer.ts (live streaming),
// both manual-on-Windows. The engine-selection decision (local vs cloud) lives renderer-side in
// useTranscriptionMode/useTranscription, tested against localStorage + the desktop model-ready status.

// BUG-52: cap whisper threads so on-device transcription never pegs the whole machine (it ran
// at 8 threads, oversubscribing a 4-core laptop → thrash + "used a lot of resource"). Use half
// the cores (min 1), leaving headroom for the app + the OS, and cap at 8 (whisper.cpp thread
// scaling plateaus ~4-8, so more is wasted contention). An explicit request still wins.
export function pickThreads(cpuCount: number, requested?: number): number {
  if (requested && requested > 0) return requested
  return Math.min(8, Math.max(1, Math.floor((cpuCount || 1) / 2)))
}
