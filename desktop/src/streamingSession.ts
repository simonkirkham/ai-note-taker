// BUG-53 (Step 2) — live streaming session over the resident whisper-server. On a timer it
// re-transcribes the recent window [finalizedMs, now] and folds the result into a growing transcript
// (streamingTranscript.reduceStream), emitting the current text ~every STEP. Replaces the
// spawn-per-window path (which reloaded the model each window → 5-7s latency + churn). The window is
// bounded by the reducer's commit, and a busy-guard drops a step rather than queueing when inference
// is slower than STEP — so it degrades to a lower cadence instead of backlogging. Retains the full
// audio for the stop-time final pass (small.en, via the CLI — unchanged from BUG-52).

import { reduceStream, initStreamState, type StreamState, type StreamConfig } from './streamingTranscript'
import type { WhisperServer } from './whisperServer'

const STEP_MS = 1500
const BYTES_PER_MS = 32 // 16 kHz * 16-bit mono → 32 bytes/ms
const MIN_NEW_MS = 500 // don't run inference until at least this much new audio has arrived

export class StreamingSession {
  private readonly chunks: Buffer[] = []
  private byteLen = 0
  private state: StreamState = initStreamState()
  private timer: ReturnType<typeof setInterval> | null = null
  private busy = false
  private disposed = false

  constructor(
    private readonly server: WhisperServer,
    private readonly onLive: (text: string) => void,
    private readonly onError: (err: Error) => void,
    private readonly cfg?: StreamConfig,
  ) {}

  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => void this.step(), STEP_MS)
  }

  pushPcm(chunk: Buffer): void {
    if (this.disposed) return
    this.chunks.push(chunk)
    this.byteLen += chunk.length
  }

  private async step(): Promise<void> {
    if (this.busy || this.disposed) return
    const startByte = this.state.finalizedMs * BYTES_PER_MS
    if (this.byteLen - startByte < MIN_NEW_MS * BYTES_PER_MS) return
    this.busy = true
    try {
      const nowMs = Math.floor(this.byteLen / BYTES_PER_MS)
      const window = this.windowSlice(startByte)
      const segs = await this.server.transcribe(window, this.state.finalizedMs)
      if (this.disposed) return
      const { state, display } = reduceStream(this.state, segs, nowMs, this.cfg)
      this.state = state
      this.onLive(display)
    } catch (err) {
      if (!this.disposed) this.onError(err as Error)
    } finally {
      this.busy = false
    }
  }

  // Concat only the chunks overlapping [startByte, end] — bounded by the (committed) window size,
  // so this stays cheap even on a long recording (the whole audio is never re-concatenated here).
  private windowSlice(startByte: number): Buffer {
    const parts: Buffer[] = []
    let pos = 0
    for (const c of this.chunks) {
      const cEnd = pos + c.length
      if (cEnd > startByte) parts.push(pos >= startByte ? c : c.subarray(startByte - pos))
      pos = cEnd
    }
    return Buffer.concat(parts)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  dispose(): void {
    this.disposed = true
    this.stop()
  }

  // The whole recording, for the stop-time final pass.
  fullAudio(): Buffer {
    return Buffer.concat(this.chunks)
  }
}
