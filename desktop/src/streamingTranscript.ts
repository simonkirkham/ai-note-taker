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
  hardWindowMs: number // runaway guard: past this, force-advance even without a settled boundary
}

// BUG-65 — these were 8000/16000, which made the steady-state re-transcribed window 8-16s rather
// than the ~3s whisperServer.ts's header comment assumed: nothing commits until the window EXCEEDS
// maxWindowMs, so maxWindowMs is the window's FLOOR, not its cap. Halved, so each 1.5s step
// re-transcribes 4-8s. hardWindowMs must stay below the encoder capacity implied by LIVE_AUDIO_CTX
// (~15s) or whisper silently truncates the newest audio — locked by serverArgs.spec.ts.
export const DEFAULT_STREAM_CONFIG: StreamConfig = { stabilityMs: 1500, maxWindowMs: 4000, hardWindowMs: 8000 }

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
  // Runaway guard: continuous speech can come back as ONE segment spanning [finalizedMs, now], whose
  // endMs never settles — so nothing commits, finalizedMs never advances, and the window grows every
  // step until inference can't keep pace. Once the window blows past the hard cap, force a commit of
  // anything that STARTED before the settled edge and advance finalizedMs to that edge, bounding it.
  const forced = windowMs >= cfg.hardWindowMs

  for (const s of segments) {
    const settled = s.endMs <= settledEdge
    if ((windowMs >= cfg.maxWindowMs && settled) || (forced && s.startMs < settledEdge)) {
      committed = join(committed, s.text)
      // Advance past the committed segment's END (not just the settled edge). For a settled segment
      // endMs <= settledEdge anyway; for a force-committed giant segment this freezes its tail so the
      // segEnd..settledEdge audio isn't re-transcribed next window (no duplicated words at the boundary).
      finalizedMs = Math.max(finalizedMs, s.endMs)
    } else {
      liveParts.push(s.text)
    }
  }
  // Guarantee progress even if no segment matched (e.g. an empty/all-live window at the hard cap).
  if (forced) finalizedMs = Math.max(finalizedMs, settledEdge)

  return { state: { committed, finalizedMs }, display: join(committed, liveParts.join(' ')) }
}
