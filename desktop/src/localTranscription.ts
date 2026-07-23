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
import { parseWhisperOutput, type WhisperSegment } from './whisperParse'

export type LocalTranscriberOptions = {
  binPath: string
  modelPath: string
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
    const stdout = await runWhisper(wav, opts)
    return parseWhisperOutput(stdout, baseMs)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

function runWhisper(wavPath: string, opts: LocalTranscriberOptions): Promise<string> {
  return new Promise((resolve, reject) => {
    // -np = print nothing but the timestamped results (clean stdout for the parser).
    const args = ['-m', opts.modelPath, '-f', wavPath, '-t', String(opts.threads ?? 8), '-np']
    const proc = spawn(opts.binPath, args)
    let out = ''
    let err = ''
    proc.stdout.on('data', (d) => (out += d.toString()))
    proc.stderr.on('data', (d) => (err += d.toString()))
    proc.on('error', reject)
    proc.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(`whisper exit ${code}: ${err.slice(-500)}`))))
  })
}

// Drives live transcription for one recording: PCM in, parsed segments out (in order).
// Windows transcribe sequentially (a promise chain) to preserve order and bound CPU.
export class LocalTranscriptionSession {
  private readonly windower: PcmWindower
  private queue: Promise<void> = Promise.resolve()
  private failed = false

  constructor(
    private readonly opts: LocalTranscriberOptions,
    private readonly onSegments: (segs: WhisperSegment[]) => void,
    private readonly onError: (err: Error) => void,
  ) {
    this.windower = new PcmWindower(opts.sampleRate ?? SAMPLE_RATE, opts.windowSeconds ?? WINDOW_SECONDS)
  }

  pushPcm(chunk: Buffer): void {
    if (this.failed) return
    this.windower.push(chunk)
    let win = this.windower.takeWindow()
    while (win) {
      this.enqueue(win)
      win = this.windower.takeWindow()
    }
  }

  // Flush the tail and wait for all windows to finish — called on stop, before commit.
  async finish(): Promise<void> {
    if (!this.failed) {
      const tail = this.windower.flush()
      if (tail) this.enqueue(tail)
    }
    await this.queue
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
