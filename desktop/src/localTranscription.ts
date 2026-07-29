// 48-A / BUG-53 — the impure whisper-cli helpers used for the batch passes (stop-time final
// transcription and 48-C source-separation diarization). The live streaming path is the resident
// whisper-server (whisperServer.ts + streamingSession.ts), not this file. Buffers PCM into a WAV,
// spawns whisper-cli, and reports parsed segments (whisperParse). Proven against a real binary in
// localTranscription.integration.spec.ts (Linux) and manually on Windows.

import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir, cpus } from 'node:os'
import path from 'node:path'
import { pickThreads } from './localEngine'
import { mergeDiarized, turnsToText } from './diarizeMerge'
import { parseWhisperOutput, type WhisperSegment } from './whisperParse'

// BUG-52: whisper children spawned here were never killed on stop/app-quit, so on Windows they
// orphaned and ran to completion in the background (a stopped recording still pegged ~50% CPU).
// Track every live child and expose a kill switch that main.ts calls on stop, new-recording, and
// app-quit — nothing survives the moment the user stops.
const activeProcs = new Set<ChildProcess>()
export function killActiveWhisper(): void {
  for (const p of activeProcs) {
    try { p.kill() } catch { /* already gone */ }
  }
  activeProcs.clear()
}

export type LocalTranscriberOptions = {
  binPath: string
  modelPath: string // live model (base.en) for the streaming windows
  finalModelPath?: string // 48-B: higher-quality model (small.en) for the stop-time full-recording pass
  vadModelPath?: string // 48-C: silero VAD model — strips silence per stream before source-separation transcription
  sampleRate?: number // default 16000
  threads?: number // default: half the cores, capped at 8 (pickThreads); an explicit value wins
}

const SAMPLE_RATE = 16000

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
// (small.en) when available, else the live model. Returns null if VAD isn't available or there
// is no speech — the caller then keeps the single-stream transcript. Passes run sequentially to
// bound CPU; each spans the whole recording (VAD skips non-speech but the stream is still
// full-length), so worst-case wall-clock is ~2x a single final pass — runWhisper's length-scaled
// timeout still bounds a hang.
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
    // BUG-52: cap threads (default half the cores) so we never peg the whole machine.
    const threads = pickThreads(cpus().length, opts.threads)
    const args = ['-m', opts.modelPath, '-f', wavPath, '-t', String(threads), '-np']
    // 48-C: VAD strips non-speech before transcription — mandatory for source separation, where
    // each stream is ~half silence (the other party's turns) and whisper otherwise loops on it.
    if (opts.vadModelPath) args.push('--vad', '-vm', opts.vadModelPath)
    const proc = spawn(opts.binPath, args)
    activeProcs.add(proc)
    let out = ''
    let err = ''
    let settled = false
    const done = (fn: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      activeProcs.delete(proc)
      fn()
    }
    const timer = setTimeout(() => done(() => {
      proc.kill()
      reject(new Error(`whisper timed out after ${timeoutMs}ms`))
    }), timeoutMs)
    proc.stdout.on('data', (d) => (out += d.toString()))
    proc.stderr.on('data', (d) => (err += d.toString()))
    proc.on('error', (e) => done(() => reject(e)))
    proc.on('close', (code) =>
      done(() => (code === 0 ? resolve(out) : reject(new Error(`whisper exit ${code}: ${err.slice(-500)}`)))),
    )
  })
}
