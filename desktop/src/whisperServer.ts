// BUG-53 (Step 2) — a persistent whisper-server child that loads the model ONCE and answers
// /inference over HTTP. Replaces the spawn-per-window live path (which reloaded the model every
// window → 5-7s latency + resource churn). The model stays resident, so re-inference on a short
// sliding window is fast (~1.4s for a 3s window on a fast CPU), giving a ~3-4s live transcript.
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

  // True once the model has loaded and the HTTP server first answered — before this, /inference just
  // errors, so the streaming session skips its steps rather than spamming failures during model load.
  get ready(): boolean {
    return this.isReady
  }

  // Spawn whisper-server, wait until it accepts requests (poll /), or reject on a startup failure.
  async start(): Promise<void> {
    if (this.proc) return
    this.port = await freePort()
    const args = ['-m', this.modelPath, '--host', '127.0.0.1', '--port', String(this.port), '-t', String(this.threads)]
    const proc = spawn(this.binPath, args)
    this.proc = proc
    let exited = false
    proc.on('exit', () => {
      exited = true
      if (this.proc === proc) this.proc = null
      this.isReady = false
    })
    // Poll until the model has loaded and the HTTP server accepts connections (or time out).
    const deadline = Date.now() + 60_000
    while (Date.now() < deadline) {
      if (exited) throw new Error('whisper-server exited during startup')
      if (await this.ping()) {
        this.isReady = true
        return
      }
      await new Promise((r) => setTimeout(r, 250))
    }
    this.kill()
    throw new Error('whisper-server did not become ready within 60s')
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
