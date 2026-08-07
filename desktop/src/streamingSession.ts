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
const FAIL_THRESHOLD = 3 // consecutive post-ready /inference failures before we call it terminal
// BUG-56 — how long the server may stay un-ready before the live view is declared dead. Longer than
// WhisperServer's own 60s start deadline, so this only fires for the case that deadline cannot see:
// a server shared from an earlier recording whose start() rejection was reported to a window that
// has since moved on. Without it, "process alive, never ready" stays silent for the whole meeting.
const READY_TIMEOUT_MS = 75_000

export type StreamingSessionOptions = { readyTimeoutMs?: number }

export class StreamingSession {
  private readonly chunks: Buffer[] = []
  private byteLen = 0
  private state: StreamState = initStreamState()
  private timer: ReturnType<typeof setInterval> | null = null
  private busy = false
  private disposed = false
  private failures = 0 // consecutive step failures; reset on success
  private terminalReported = false // onError fired once — don't spam the banner every step
  private sawReady = false // the server became ready at least once (so a later !running == a crash)
  private readyTimer: ReturnType<typeof setTimeout> | null = null
  // windowSlice cursor: chunks before scanIdx are fully committed (never in a future window). startByte
  // only grows, so advancing this makes each slice O(window) instead of O(whole recording so far).
  private scanIdx = 0
  private scanIdxByte = 0

  constructor(
    private readonly server: WhisperServer,
    private readonly onLive: (text: string) => void,
    private readonly onError: (err: Error) => void,
    private readonly cfg?: StreamConfig,
    private readonly opts?: StreamingSessionOptions,
  ) {}

  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => void this.step(), STEP_MS)
    // BUG-56: armed on its own one-shot timer rather than checked inside step(), so the deadline is
    // independent of the step cadence and of whether any step has run yet. Reads server.ready
    // directly (not sawReady, which only updates on a step) so a server that loaded in time is
    // never falsely reported.
    this.readyTimer = setTimeout(() => {
      if (this.disposed || this.terminalReported || this.server.ready) return
      this.terminalReported = true
      this.onError(new Error('whisper-server did not become ready; the live transcript stayed empty'))
    }, this.opts?.readyTimeoutMs ?? READY_TIMEOUT_MS)
  }

  pushPcm(chunk: Buffer): void {
    if (this.disposed) return
    this.chunks.push(chunk)
    this.byteLen += chunk.length
  }

  private async step(): Promise<void> {
    if (this.busy || this.disposed) return
    if (!this.server.running) {
      // A server that had become ready and is now gone crashed mid-recording — report it once so the
      // renderer's banner fires (a start-time failure is surfaced by the IPC layer instead). If it was
      // never ready, this is the IPC layer's start-failure case → stay quiet here.
      if (this.sawReady && !this.terminalReported) {
        this.terminalReported = true
        this.onError(new Error('whisper-server exited during the recording'))
      }
      return
    }
    // Skip quietly while the server is still loading its model — not a per-step failure, so it doesn't
    // count toward the terminal threshold or spam /inference during load. A load that never finishes
    // is caught by the ready deadline armed in start() (BUG-56), not here.
    if (!this.server.ready) return
    this.sawReady = true
    const startByte = this.state.finalizedMs * BYTES_PER_MS
    if (this.byteLen - startByte < MIN_NEW_MS * BYTES_PER_MS) return
    this.busy = true
    try {
      const nowMs = Math.floor(this.byteLen / BYTES_PER_MS)
      const window = this.windowSlice(startByte)
      const segs = await this.server.transcribe(window, this.state.finalizedMs)
      if (this.disposed) return
      this.failures = 0
      const { state, display } = reduceStream(this.state, segs, nowMs, this.cfg)
      this.state = state
      this.onLive(display)
    } catch (err) {
      // A single hiccup (an aborted slow window, a transient error) is tolerated; only a sustained run
      // of failures against a ready server is terminal — report it once so the renderer's banner fires.
      if (this.disposed) return
      this.failures++
      if (this.failures >= FAIL_THRESHOLD && !this.terminalReported) {
        this.terminalReported = true
        this.onError(err as Error)
      }
    } finally {
      this.busy = false
    }
  }

  // Concat only the chunks overlapping [startByte, end]. startByte is monotonic, so we advance a cursor
  // past chunks entirely before it (kept intact for fullAudio) — each slice is O(window), not O(whole
  // recording). The whole audio is never re-concatenated here.
  private windowSlice(startByte: number): Buffer {
    while (this.scanIdx < this.chunks.length && this.scanIdxByte + this.chunks[this.scanIdx].length <= startByte) {
      this.scanIdxByte += this.chunks[this.scanIdx].length
      this.scanIdx++
    }
    const parts: Buffer[] = []
    let pos = this.scanIdxByte
    for (let i = this.scanIdx; i < this.chunks.length; i++) {
      const c = this.chunks[i]
      parts.push(pos >= startByte ? c : c.subarray(startByte - pos))
      pos += c.length
    }
    return Buffer.concat(parts)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    if (this.readyTimer) clearTimeout(this.readyTimer)
    this.readyTimer = null
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
