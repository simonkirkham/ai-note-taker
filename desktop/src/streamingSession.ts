// BUG-53 (Step 2) — live streaming session over the resident whisper-server. On a timer it
// re-transcribes the recent window [finalizedMs, now] and folds the result into a growing transcript
// (streamingTranscript.reduceStream), emitting the current text ~every STEP. Replaces the
// spawn-per-window path (which reloaded the model each window → 5-7s latency + churn). The window is
// bounded by the reducer's commit, and a busy-guard drops a step rather than queueing when inference
// is slower than STEP — so it degrades to a lower cadence instead of backlogging. Retains the full
// audio for the stop-time final pass (small.en, via the CLI — unchanged from BUG-52).

import { reduceStream, initStreamState, type StreamState, type StreamConfig } from './streamingTranscript'
import { audioCtxSeconds, LIVE_AUDIO_CTX, type WhisperServer } from './whisperServer'

const STEP_MS = 1500
const BYTES_PER_MS = 32 // 16 kHz * 16-bit mono → 32 bytes/ms
const MIN_NEW_MS = 500 // don't run inference until at least this much new audio has arrived
const FAIL_THRESHOLD = 3 // consecutive post-ready /inference failures before we call it terminal
// BUG-56 — how long the server may stay un-ready before the live view is declared dead. Must sit
// BELOW WhisperServer's start deadline: once start() gives up it kills the child and nulls proc, so
// a longer deadline can only ever observe a dead process and is unreachable by construction. The
// first version of this was set above it and was dead code — a mechanism that reads as live and is
// not, which is the very shape of the bug this slice fixes. `readyDeadlineIsReachable` locks it.
export const READY_TIMEOUT_MS = 45_000

// Don't accuse the engine of failing to load when the recording barely outlived the model load. The
// first local recording after launch legitimately spends seconds loading base.en, so a 3s recording
// stopping mid-load is not a fault — reporting one would put a failure banner beside a perfectly
// good stop-time transcript. Only applies to the stop path; the deadline itself is time-based.
const MIN_SESSION_FOR_STOP_REPORT_MS = 20_000

// User-facing causes. The renderer supplies the "On-device transcription failed:" frame, so these
// are bare phrases — and deliberately name no binary or transport detail.
const LIVE_ENGINE_STOPPED = 'the on-device engine stopped during the recording'
const LIVE_ENGINE_UNRESPONSIVE = 'the on-device engine stopped responding'
const LIVE_ENGINE_NEVER_LOADED = 'the on-device engine did not finish loading; the live transcript stayed empty'

// BUG-65 — the most audio we will ever send in one /inference. Sits below the ~15.4s the encoder
// can hold at LIVE_AUDIO_CTX, with margin: past the context whisper truncates the mel but still
// seeks a full 30s on a missed timestamp, so audio would be skipped entirely rather than merely
// degraded. Derived from the encoder constant rather than written as a literal, so lowering
// LIVE_AUDIO_CTX cannot silently leave this stranded above it.
export const MAX_SEND_WINDOW_MS = Math.floor(audioCtxSeconds(LIVE_AUDIO_CTX) * 1000 * 0.9)

export type LiveStepStat = {
  windowMs: number
  inferenceMs: number // -1 when the step failed
  committedChars: number
  dropped: number
  clampedMs: number // audio withheld this step by MAX_SEND_WINDOW_MS (0 normally)
  error?: string
}

export type StreamingSessionOptions = {
  readyTimeoutMs?: number
  minSessionForStopReportMs?: number
  maxSendWindowMs?: number
  // BUG-65: per-step cost, for the on-device diagnostic log.
  onStep?: (s: LiveStepStat) => void
}

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
  private droppedSinceLog = 0 // steps the busy-guard skipped since the last reported step
  private lastStepByteLen = -1 // byteLen at the last step actually run (BUG-67 idle detection)
  private startedAt = 0 // when start() armed the timers — the stop-path grace period runs from here
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
    this.startedAt = Date.now()
    this.timer = setInterval(() => void this.step(), STEP_MS)
    // BUG-56: armed on its own one-shot timer rather than checked inside step(), so the deadline is
    // independent of the step cadence and of whether any step has run yet.
    this.readyTimer = setTimeout(() => this.reportLiveViewDead(), this.opts?.readyTimeoutMs ?? READY_TIMEOUT_MS)
  }

  pushPcm(chunk: Buffer): void {
    if (this.disposed) return
    this.chunks.push(chunk)
    this.byteLen += chunk.length
  }

  private async step(): Promise<void> {
    // BUG-65: a step skipped because the previous inference is still running is the signal that the
    // engine cannot keep pace — count it, so the log distinguishes "slow" from "falling behind".
    if (this.busy) {
      this.droppedSinceLog++
      return
    }
    if (this.disposed) return
    if (!this.server.running) {
      // A server that had become ready and is now gone crashed mid-recording — report it once so the
      // renderer's banner fires (a start-time failure is surfaced by the IPC layer instead). If it was
      // never ready, this is the IPC layer's start-failure case → stay quiet here.
      if (this.sawReady && !this.terminalReported) {
        this.terminalReported = true
        // Same wording as the stop-path branch below: one condition must not produce two different
        // banners depending on which timer happened to notice, and the user-facing text must not
        // name an internal binary.
        this.onError(new Error(LIVE_ENGINE_STOPPED))
      }
      return
    }
    // Skip quietly while the server is still loading its model — not a per-step failure, so it doesn't
    // count toward the terminal threshold or spam /inference during load. A load that never finishes
    // is caught by the ready deadline armed in start() (BUG-56), not here.
    if (!this.server.ready) return
    this.sawReady = true
    // BUG-67: nothing has ARRIVED since the last step, so re-running would re-transcribe byte-for-
    // byte identical audio for an identical result. MIN_NEW_MS below does not cover this — it gates
    // on the window SIZE (byteLen - startByte), which stays large while the window is stale, so once
    // PCM stopped the session spun forever. It mattered because the renderer awaits diarize (two
    // whisper-cli passes) after Stop before anything halts this session, so the spin competed for
    // cores with the pass the user was waiting for.
    if (this.byteLen === this.lastStepByteLen) return
    const startByte = this.state.finalizedMs * BYTES_PER_MS
    if (this.byteLen - startByte < MIN_NEW_MS * BYTES_PER_MS) return
    this.lastStepByteLen = this.byteLen
    this.busy = true
    // Declared OUTSIDE the try so the catch can report them too: the window size at the moment of
    // failure is the number that says whether the clamp was engaged when it died, and it is
    // unrecoverable if it goes out of scope.
    const rawNowMs = Math.floor(this.byteLen / BYTES_PER_MS)
    const cap = this.opts?.maxSendWindowMs ?? MAX_SEND_WINDOW_MS
    const nowMs = Math.min(rawNowMs, this.state.finalizedMs + cap)
    const clampedMs = rawNowMs - nowMs
    const windowMs = nowMs - this.state.finalizedMs
    const startedAt = Date.now()
    try {
      // BUG-65: hardWindowMs does NOT bound the runtime window (see the clamp computed above).
      // finalizedMs only advances after an inference completes, and the busy-guard drops ticks
      // meanwhile, so steady state is roughly inferenceMs + stabilityMs + STEP_MS — which on a slow
      // machine (/inference alone tolerates 20s) exceeds the ~15.4s the encoder holds at
      // LIVE_AUDIO_CTX. Overshooting is not merely "sees less": whisper truncates the mel copy at
      // the context, but the seek loop still advances a full 30s on a missed timestamp, so audio
      // would be skipped outright. Clamping what we SEND makes the newest tail wait a step instead.
      const window = this.windowSlice(startByte, nowMs * BYTES_PER_MS)
      const segs = await this.server.transcribe(window, this.state.finalizedMs)
      if (this.disposed) return
      this.failures = 0
      const { state, display } = reduceStream(this.state, segs, nowMs, this.cfg)
      this.state = state
      this.onLive(display)
      // BUG-65: report what the step actually cost. Without this there is no way to tell which of
      // the four suspected causes dominates, or to prove a tuning change helped.
      this.report({
        windowMs,
        inferenceMs: Date.now() - startedAt,
        committedChars: state.committed.length,
        dropped: this.droppedSinceLog,
        clampedMs,
      })
      this.droppedSinceLog = 0
    } catch (err) {
      // A single hiccup (an aborted slow window, a transient error) is tolerated; only a sustained run
      // of failures against a ready server is terminal — report it once so the renderer's banner fires.
      if (this.disposed) return
      this.failures++
      // BUG-65: a FAILED step must still leave a trace. A run of 20s /inference timeouts is the most
      // likely shape of "very slow", and reporting only on success would leave the diagnostic log
      // silent for exactly that case — the hole this instrumentation exists to close.
      this.report({
        windowMs,
        inferenceMs: Date.now() - startedAt,
        committedChars: this.state.committed.length,
        dropped: this.droppedSinceLog,
        clampedMs,
        error: (err as Error).message,
      })
      this.droppedSinceLog = 0
      if (this.failures >= FAIL_THRESHOLD && !this.terminalReported) {
        this.terminalReported = true
        // Never forward the raw transport error: it reaches the banner verbatim, where "The
        // operation was aborted due to a timeout" or "/inference 500" means nothing to the user.
        // The original rides along as `cause` so the main process can still log it.
        this.onError(new Error(LIVE_ENGINE_UNRESPONSIVE, { cause: err }))
      }
    } finally {
      this.busy = false
    }
  }

  // A step's stats never reach the caller raw: onStep is supplied by the IPC layer and runs inside
  // step()'s try, so a throw in the diagnostic would increment `failures` and could raise a false
  // "engine stopped responding" banner. A diagnostic must not be able to break a recording.
  private report(s: LiveStepStat): void {
    try {
      this.opts?.onStep?.(s)
    } catch {
      /* diagnostics are best-effort */
    }
  }

  // Concat only the chunks overlapping [startByte, endByte). startByte is monotonic, so we advance a
  // cursor past chunks entirely before it (kept intact for fullAudio) — each slice is O(window), not
  // O(whole recording). The whole audio is never re-concatenated here.
  private windowSlice(startByte: number, endByte: number): Buffer {
    while (this.scanIdx < this.chunks.length && this.scanIdxByte + this.chunks[this.scanIdx].length <= startByte) {
      this.scanIdxByte += this.chunks[this.scanIdx].length
      this.scanIdx++
    }
    const parts: Buffer[] = []
    let pos = this.scanIdxByte
    for (let i = this.scanIdx; i < this.chunks.length && pos < endByte; i++) {
      const c = this.chunks[i]
      const from = pos >= startByte ? 0 : startByte - pos
      // Trim the tail too (BUG-65's clamp): a chunk straddling endByte contributes only its head.
      const to = pos + c.length <= endByte ? c.length : endByte - pos
      if (to > from) parts.push(c.subarray(from, to))
      pos += c.length
    }
    return Buffer.concat(parts)
  }

  // BUG-56 — is the live view dead, and if so can we say something true about it? Reads
  // server.ready directly (not sawReady, which only updates on a step) so a server that loaded in
  // time is never falsely reported. `fromStop` marks the on-the-way-out check, which carries a
  // grace period the time-based deadline does not need.
  private reportLiveViewDead(fromStop = false): void {
    if (this.disposed || this.terminalReported) return
    if (this.server.ready) {
      this.sawReady = true
      return
    }
    // The process is GONE. If it had been ready, it crashed — and a crash after the final step
    // would otherwise go unreported, since step() never runs again. If it was NEVER ready, a failed
    // start() nulls proc and the start-failure channel (ensureServer's catch) has already shown an
    // accurate "failed to start" banner; overwriting it here would tell the user the wrong thing.
    if (!this.server.running) {
      if (!this.sawReady) return
      this.terminalReported = true
      this.onError(new Error(LIVE_ENGINE_STOPPED))
      return
    }
    // Alive but still loading. On the stop path, only complain if the recording ran long enough
    // that a live transcript was a reasonable expectation.
    const grace = this.opts?.minSessionForStopReportMs ?? MIN_SESSION_FOR_STOP_REPORT_MS
    if (fromStop && Date.now() - this.startedAt < grace) return
    this.terminalReported = true
    this.onError(new Error(LIVE_ENGINE_NEVER_LOADED))
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    if (this.readyTimer) clearTimeout(this.readyTimer)
    this.readyTimer = null
    // A recording that ends before the deadline would otherwise finish with an empty live view and
    // no explanation — the original silent failure, just briefer. Check once on the way out.
    this.reportLiveViewDead(true)
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
