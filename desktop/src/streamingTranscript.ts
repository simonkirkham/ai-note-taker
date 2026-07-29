// BUG-53 (Step 2) — pure sliding-window streaming reducer. The engine re-transcribes the window
// [finalizedMs, now] against the resident whisper-server every ~1.5s. This turns those overlapping
// window transcriptions into a stable growing transcript: segments that have "settled" (ended well
// before the live edge) get committed, so the re-transcribed window stays bounded and the committed
// text stops flickering. The live tail is the still-settling recent audio. It's a heuristic — the
// authoritative transcript is the stop-time final pass — but it gives a coherent ~3-4s live view.

import type { WhisperSegment } from './whisperParse'

export type StreamState = {
  committed: string // finalized text (won't change)
  finalizedMs: number // audio before this is committed → the next window starts here
}

export type StreamConfig = {
  stabilityMs: number // a segment ending before now-stabilityMs is "settled"
  maxWindowMs: number // only commit once the window exceeds this (bounds re-transcribe cost)
}

export const DEFAULT_STREAM_CONFIG: StreamConfig = { stabilityMs: 1500, maxWindowMs: 8000 }

export function initStreamState(): StreamState {
  return { committed: '', finalizedMs: 0 }
}

function join(a: string, b: string): string {
  if (!a) return b
  if (!b) return a
  return `${a} ${b}`
}

// Fold one window transcription into the running transcript. `segments` are the resident server's
// transcription of [state.finalizedMs, nowMs] (absolute ms). Returns the new state + what to display.
export function reduceStream(
  state: StreamState,
  segments: WhisperSegment[],
  nowMs: number,
  cfg: StreamConfig = DEFAULT_STREAM_CONFIG,
): { state: StreamState; display: string } {
  let committed = state.committed
  let finalizedMs = state.finalizedMs
  const liveParts: string[] = []

  const windowMs = nowMs - state.finalizedMs
  const settledEdge = nowMs - cfg.stabilityMs

  for (const s of segments) {
    // Commit a segment only once the window is long enough AND the segment has settled — otherwise
    // it stays in the live tail where it can still change as more audio arrives.
    if (windowMs >= cfg.maxWindowMs && s.endMs <= settledEdge) {
      committed = join(committed, s.text)
      finalizedMs = Math.max(finalizedMs, s.endMs)
    } else {
      liveParts.push(s.text)
    }
  }

  return { state: { committed, finalizedMs }, display: join(committed, liveParts.join(' ')) }
}
