// BUG-53 (Step 2) — a persistent whisper-server child that loads the model ONCE and answers
// /inference over HTTP. Replaces the spawn-per-window live path (which reloaded the model every
// window → 5-7s latency + resource churn). The model stays resident, so re-inference on a short
// sliding window avoids reloading the model each time. (The original "~1.4s for a 3s window →
// ~3-4s live transcript" claim did not survive contact with a real machine — see BUG-65: whisper
// encodes a padded 30s mel regardless of window length, and the window was never really 3s.)
// It's a child process, so BUG-52's kill-on-quit lifecycle covers it (killActiveWhisper).

import { spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'
import { encodeWav } from './localTranscription'
import type { WhisperSegment } from './whisperParse'

// Ask the OS for a free port (bind :0, read it, release) so we never collide with another process.
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer()
    srv.once('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      srv.close(() => (port ? resolve(port) : reject(new Error('no free port'))))
    })
  })
}

// A hung server (accepts the connection but never responds) must not freeze the live view forever —
// the streaming session's busy-guard would never release. Bound each /inference; an over-run aborts
// and the session drops that step (and counts it toward its terminal-failure threshold).
const INFERENCE_TIMEOUT_MS = 20_000

// How long start() waits for the model to load and the HTTP server to answer before killing the
// child and rejecting. Exported because StreamingSession's ready deadline must fire BELOW it: once
// start() gives up it nulls the process, and a deadline above this can only ever observe a dead
// process — which is exactly how the first attempt at that deadline shipped as dead code.
export const SERVER_START_TIMEOUT_MS = 60_000

// BUG-65 — whisper always encodes a PADDED 30-SECOND mel, so a 3s window costs almost what 30s
// does. `--audio-ctx` shortens that encoder context and is the biggest available lever on live
// latency. 768 ≈ 15s of capacity.
//
// It is an EXPERIMENTAL upstream option — whisper.h labels it "can significantly reduce the quality
// of the output", and the maintainer advises against it for audio beyond ~10-15s. Taken anyway
// because the live transcript is *mostly* disposable (48-B re-transcribes with small.en at stop);
// "mostly" is load-bearing, since `local:finish` has three paths where the LIVE text becomes the
// saved note (no small.en yet, final pass throws, final pass empty).
//
// 768 rather than any other reduction: GGML_PAD(n_ctx, 256) makes 768 = 3×256 exactly, giving zero
// unmasked pad rows versus 36 at the 1500 default — which matters while the upstream pad-row
// attention bug (whisper.cpp PR #3941) is open.
//
// NOT true, though an earlier version of this comment said so: whisper.cpp's `stream` example does
// NOT use 768 — `stream.cpp` defaults audio_ctx to 0 (full context). The 768 figure comes from the
// `command` example, a short-utterance workload.
export const AUDIO_CTX_FULL = 1500 // whisper's full context = 30s
export const LIVE_AUDIO_CTX = 768

// Encoder context → seconds of audio it can hold.
export function audioCtxSeconds(ctx: number): number {
  return (ctx / AUDIO_CTX_FULL) * 30
}

// Pure, so the flags are asserted headlessly. Every argument is a chance to hit the server's
// unknown-argument path — which calls `exit(0)`, so a mistyped flag looks like a CLEAN SHUTDOWN
// rather than a failure. That is exactly how BUG-56 killed the live transcript, so the set is
// deliberately minimal and every entry was verified against the pinned v1.9.1 parser.
//
// Deliberately NOT passed:
//  - `--flash-attn` — already defaults to true, so passing it is a no-op.
//  - beam/best-of flags — `beam_size = -1` already selects greedy.
//  - `--no-fallback` — **the server parses it and never reads it.** cli.cpp and stream.cpp both do
//    `no_fallback ? 0.0f : …`; server.cpp assigns `wparams.temperature_inc` unconditionally, so the
//    flag is dead in every release through v1.9.1. Passing it would be a no-op that LOOKS like a
//    fix. The only working lever is a per-request `temperature_inc`, deliberately not used yet:
//    collapsing the temperature ladder also disables whisper's repetition guard, and a reduced
//    audio_ctx is documented to *induce* repetition loops — so it would trade latency for a
//    hallucination risk that this very change creates. Measure first.
export function buildServerArgs(opts: { modelPath: string; port: number; threads: number }): string[] {
  return [
    '-m',
    opts.modelPath,
    '--host',
    '127.0.0.1',
    '--port',
    String(opts.port),
    '-t',
    String(opts.threads),
    '--audio-ctx',
    String(LIVE_AUDIO_CTX),
  ]
}

export class WhisperServer {
  private proc: ChildProcess | null = null
  private port = 0
  private isReady = false

  constructor(
    private readonly binPath: string,
    private readonly modelPath: string,
    private readonly threads: number,
  ) {}

  get running(): boolean {
    return this.proc !== null
  }

  // BUG-56: lets a caller reusing this warm server confirm it was built from the binary and model
  // it expects, rather than assuming — and report what it actually holds when it isn't.
  matches(binPath: string, modelPath: string): boolean {
    return this.binPath === binPath && this.modelPath === modelPath
  }

  describe(): { binPath: string; modelPath: string } {
    return { binPath: this.binPath, modelPath: this.modelPath }
  }

  // True once the model has loaded and the HTTP server first answered — before this, /inference just
  // errors, so the streaming session skips its steps rather than spamming failures during model load.
  get ready(): boolean {
    return this.isReady
  }

  // Spawn whisper-server, wait until it accepts requests (poll /), or reject on a startup failure.
  async start(): Promise<void> {
    if (this.proc) return
    this.port = await freePort()
    const args = buildServerArgs({ modelPath: this.modelPath, port: this.port, threads: this.threads })
    const proc = spawn(this.binPath, args)
    this.proc = proc
    let exited = false
    // BUG-56: a ChildProcess 'error' (ENOENT — the binary is absent from the bundle) has no default
    // handler, so an unhandled 'error' event would throw *inside the Electron main process* rather
    // than rejecting start(). Capture it so the caller's catch fires the on-device-failed banner.
    // Boxed because the assignment happens in a callback: a plain local narrows to `never` below.
    const spawnFailure: { error: Error | null } = { error: null }
    proc.on('error', (err: Error) => {
      spawnFailure.error = err
      if (this.proc === proc) this.proc = null
      this.isReady = false
    })
    proc.on('exit', () => {
      exited = true
      if (this.proc === proc) this.proc = null
      this.isReady = false
    })
    // Poll until the model has loaded and the HTTP server accepts connections (or time out).
    const deadline = Date.now() + SERVER_START_TIMEOUT_MS
    while (Date.now() < deadline) {
      if (spawnFailure.error) throw new Error(`whisper-server could not be started: ${spawnFailure.error.message}`)
      if (exited) throw new Error('whisper-server exited during startup')
      if (await this.ping()) {
        this.isReady = true
        return
      }
      await new Promise((r) => setTimeout(r, 250))
    }
    this.kill()
    throw new Error(`whisper-server did not become ready within ${SERVER_START_TIMEOUT_MS / 1000}s`)
  }

  private async ping(): Promise<boolean> {
    try {
      // Any response (even 404/405) means the HTTP server is up and the model finished loading.
      const res = await fetch(`http://127.0.0.1:${this.port}/`, { method: 'GET' })
      return res.status > 0
    } catch {
      return false
    }
  }

  // Transcribe one PCM window; return segments with absolute-to-the-window ms offset by baseMs.
  async transcribe(pcm: Buffer, baseMs = 0, sampleRate = 16000): Promise<WhisperSegment[]> {
    if (!this.proc) throw new Error('whisper-server not running')
    const form = new FormData()
    form.append('file', new Blob([new Uint8Array(encodeWav(pcm, sampleRate))], { type: 'audio/wav' }), 'w.wav')
    form.append('response_format', 'verbose_json')
    form.append('temperature', '0')
    const res = await fetch(`http://127.0.0.1:${this.port}/inference`, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(INFERENCE_TIMEOUT_MS),
    })
    if (!res.ok) throw new Error(`whisper-server /inference ${res.status}`)
    const json = (await res.json()) as { segments?: { start: number; end: number; text: string }[] }
    return parseServerSegments(json, baseMs)
  }

  kill(): void {
    this.isReady = false
    if (this.proc) {
      try {
        this.proc.kill()
      } catch {
        /* already gone */
      }
      this.proc = null
    }
  }
}

// Pure: whisper-server verbose_json → WhisperSegment[] (seconds → ms, offset, drop non-speech/empty).
export function parseServerSegments(
  json: { segments?: { start: number; end: number; text: string }[] },
  baseMs = 0,
): WhisperSegment[] {
  const out: WhisperSegment[] = []
  for (const s of json.segments ?? []) {
    const text = (s.text ?? '').trim()
    // Skip empty + fully-bracketed non-speech ([BLANK_AUDIO], (noise), *music*). Intentionally broad:
    // it also drops a rare wholly-parenthesised utterance — acceptable for a live heuristic (the
    // authoritative transcript is the stop-time final pass).
    if (!text || /^[[(].*[\])]$/.test(text)) continue
    out.push({ startMs: baseMs + Math.round(s.start * 1000), endMs: baseMs + Math.round(s.end * 1000), text })
  }
  return out
}
