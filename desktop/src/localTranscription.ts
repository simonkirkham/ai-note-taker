// 48-A — the impure local-transcription engine main.ts drives. Buffers PCM from the
// renderer, slices it into windows (localEngine.PcmWindower), transcribes each with a
// whisper-cli child process, and reports parsed segments (whisperParse). The pure pieces
// are unit-tested headlessly; this orchestrator is proven against a real binary in
// localTranscription.integration.spec.ts (Linux) and manually on Windows.

import { spawn } from 'node:child_process'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { PcmWindower } from './localEngine'
import { mergeDiarized, turnsToText } from './diarizeMerge'
import { parseWhisperOutput, type WhisperSegment } from './whisperParse'

export type LocalTranscriberOptions = {
  binPath: string
  modelPath: string // live model (base.en) for the streaming windows
  finalModelPath?: string // 48-B: higher-quality model (medium.en) for the stop-time full-recording pass
  vadModelPath?: string // 48-C: silero VAD model — strips silence per stream before source-separation transcription
  sampleRate?: number // default 16000
  windowSeconds?: number // default 5 — live cadence
  threads?: number // default 8
}

const SAMPLE_RATE = 16000
const WINDOW_SECONDS = 5

// Minimal 16-bit mono PCM → WAV. whisper-cli reads WAV; a temp file per window is the
// simplest robust hand-off (stdin is unreliable across platforms).
export function encodeWav(pcm: Buffer, sampleRate = SAMPLE_RATE): Buffer {
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + pcm.length, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16) // PCM chunk size
  header.writeUInt16LE(1, 20) // PCM
  header.writeUInt16LE(1, 22) // mono
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(sampleRate * 2, 28) // byte rate
  header.writeUInt16LE(2, 32) // block align
  header.writeUInt16LE(16, 34) // bits per sample
  header.write('data', 36)
  header.writeUInt32LE(pcm.length, 40)
  return Buffer.concat([header, pcm])
}

// Run whisper-cli once over one PCM window; return its speech segments offset by baseMs.
export async function transcribeWindow(
  pcm: Buffer,
  baseMs: number,
  opts: LocalTranscriberOptions,
): Promise<WhisperSegment[]> {
  const sampleRate = opts.sampleRate ?? SAMPLE_RATE
  const dir = await mkdtemp(path.join(tmpdir(), 'ain-whisper-'))
  const wav = path.join(dir, 'w.wav')
  try {
    await writeFile(wav, encodeWav(pcm, sampleRate))
    // Wall-clock cap so a hung/pathologically-slow child can't wedge the pass forever. Scaled to
    // the audio length (whisper runs faster-than-realtime, so ~6× realtime is a generous floor
    // even on a slow CPU), with a 2-minute minimum for short clips.
    const audioSeconds = pcm.length / 2 / sampleRate
    const timeoutMs = Math.max(120_000, Math.ceil(audioSeconds * 6) * 1000)
    const stdout = await runWhisper(wav, opts, timeoutMs)
    return parseWhisperOutput(stdout, baseMs)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

// 48-C — 1:1 diarization by source separation. The renderer captures "me" (mic) and "them"
// (loopback) as SEPARATE streams that share t=0; transcribe each with VAD (mandatory — each
// stream is ~half silence) and interleave into a Me/Them transcript. Uses the final model
// (medium.en) when available, else the live model. Returns null if VAD isn't available or there
// is no speech — the caller then keeps the single-stream transcript. Passes run sequentially to
// bound CPU (VAD makes each ~half-length, so it's ≈ one full pass).
export async function diarizeStreams(
  meAudio: Buffer,
  themAudio: Buffer,
  opts: LocalTranscriberOptions,
): Promise<string | null> {
  if (!opts.vadModelPath) return null
  const streamOpts: LocalTranscriberOptions = { ...opts, modelPath: opts.finalModelPath ?? opts.modelPath }
  const me = meAudio.length ? await transcribeWindow(meAudio, 0, streamOpts) : []
  const them = themAudio.length ? await transcribeWindow(themAudio, 0, streamOpts) : []
  const text = turnsToText(mergeDiarized(me, them))
  return text.length ? text : null
}

function runWhisper(wavPath: string, opts: LocalTranscriberOptions, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    // -np = print nothing but the timestamped results (clean stdout for the parser).
    const args = ['-m', opts.modelPath, '-f', wavPath, '-t', String(opts.threads ?? 8), '-np']
    // 48-C: VAD strips non-speech before transcription — mandatory for source separation, where
    // each stream is ~half silence (the other party's turns) and whisper otherwise loops on it.
    if (opts.vadModelPath) args.push('--vad', '-vm', opts.vadModelPath)
    const proc = spawn(opts.binPath, args)
    let out = ''
    let err = ''
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      proc.kill()
      reject(new Error(`whisper timed out after ${timeoutMs}ms`))
    }, timeoutMs)
    proc.stdout.on('data', (d) => (out += d.toString()))
    proc.stderr.on('data', (d) => (err += d.toString()))
    proc.on('error', (e) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(e)
    })
    proc.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      code === 0 ? resolve(out) : reject(new Error(`whisper exit ${code}: ${err.slice(-500)}`))
    })
  })
}

// Drives live transcription for one recording: PCM in, parsed segments out (in order).
// Windows transcribe sequentially (a promise chain) to preserve order and bound CPU.
export class LocalTranscriptionSession {
  private readonly windower: PcmWindower
  private queue: Promise<void> = Promise.resolve()
  private failed = false
  // 48-B: retain the whole recording so the stop-time final pass can re-transcribe it at higher
  // quality (medium.en). Same PCM the live windows saw; ~2.6 MB/min at 16 kHz mono 16-bit.
  private readonly fullAudio: Buffer[] = []

  constructor(
    private readonly opts: LocalTranscriberOptions,
    private readonly onSegments: (segs: WhisperSegment[]) => void,
    private readonly onError: (err: Error) => void,
  ) {
    this.windower = new PcmWindower(opts.sampleRate ?? SAMPLE_RATE, opts.windowSeconds ?? WINDOW_SECONDS)
  }

  pushPcm(chunk: Buffer): void {
    if (this.failed) return
    this.fullAudio.push(chunk)
    this.windower.push(chunk)
    let win = this.windower.takeWindow()
    while (win) {
      this.enqueue(win)
      win = this.windower.takeWindow()
    }
  }

  // Flush the tail and wait for all live windows to finish — called on stop, before the final pass.
  async finish(): Promise<void> {
    if (!this.failed) {
      const tail = this.windower.flush()
      if (tail) this.enqueue(tail)
    }
    await this.queue
  }

  // 48-B: re-transcribe the whole recording with the higher-quality final model, returning the
  // full transcript text. Returns null when no final model is configured/available (caller keeps
  // the live text) or the recording is empty. Run after finish().
  async runFinalPass(): Promise<string | null> {
    if (!this.opts.finalModelPath || this.fullAudio.length === 0) return null
    const audio = Buffer.concat(this.fullAudio)
    this.fullAudio.length = 0 // release the retained chunks; the concatenated copy is enough now
    const segs = await transcribeWindow(audio, 0, { ...this.opts, modelPath: this.opts.finalModelPath })
    if (segs.length === 0) return null
    return segs.map((s) => s.text).join(' ')
  }

  private enqueue(win: { pcm: Buffer; baseMs: number }): void {
    this.queue = this.queue.then(async () => {
      if (this.failed) return
      try {
        const segs = await transcribeWindow(win.pcm, win.baseMs, this.opts)
        if (segs.length) this.onSegments(segs)
      } catch (e) {
        this.failed = true
        this.onError(e as Error)
      }
    })
  }
}
