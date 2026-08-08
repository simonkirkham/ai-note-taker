// BUG-65 — a rolling log for the on-device transcription engine, written to
// <userData>/local-transcription.log so a user on a packaged build can hand over real numbers.
// Nothing else in the desktop shell is observable once it is installed: whisper-server's stdout is
// not captured and console output needs DevTools, which is why BUG-56 and BUG-65 both had to be
// diagnosed by reading code rather than evidence.
//
// Pure formatting is separated from the file write so the format is unit-tested headlessly.

import { appendFileSync, statSync, renameSync, existsSync } from 'node:fs'
import path from 'node:path'

// Keep it small: this is a diagnostic a user emails, not a metrics pipeline. One rotation only, so
// a long meeting can never fill a disk.
export const MAX_LOG_BYTES = 512 * 1024

export type LiveStep = {
  windowMs: number // audio re-transcribed this step
  inferenceMs: number // how long whisper took; -1 when the step failed
  committedChars: number // size of the settled transcript so far
  dropped: number // steps skipped by the busy-guard since the last log line
  clampedMs?: number // audio withheld by the send cap (0 normally; >0 means we are behind)
  error?: string // present when the step failed — a run of these IS the diagnosis
}

export function formatStep(s: LiveStep): string {
  if (s.error) {
    return `step FAILED dropped=${s.dropped} committed=${s.committedChars} err=${s.error}`
  }
  // realtime factor: <1 means inference is faster than the audio it covers — the number that
  // decides whether the live view can keep pace at all.
  const rtf = s.windowMs > 0 ? (s.inferenceMs / s.windowMs).toFixed(2) : 'n/a'
  const clamped = s.clampedMs ? ` clamped=${s.clampedMs}ms` : ''
  return `step window=${s.windowMs}ms infer=${s.inferenceMs}ms rtf=${rtf} committed=${s.committedChars} dropped=${s.dropped}${clamped}`
}

export function formatSessionStart(o: {
  cores: number
  threads: number
  audioCtx: number
  maxWindowMs: number
  hardWindowMs: number
  model: string
}): string {
  return (
    `session start cores=${o.cores} threads=${o.threads} audioCtx=${o.audioCtx} ` +
    `maxWindow=${o.maxWindowMs}ms hardWindow=${o.hardWindowMs}ms model=${path.basename(o.model)}`
  )
}

export function logPath(userDataDir: string): string {
  return path.join(userDataDir, 'local-transcription.log')
}

// Append one timestamped line. Never throws — a diagnostic must not be able to break a recording.
// The timestamp is taken here rather than passed in because this is the impure edge already.
export function appendLog(userDataDir: string, line: string): void {
  try {
    const file = logPath(userDataDir)
    if (existsSync(file) && statSync(file).size > MAX_LOG_BYTES) {
      renameSync(file, `${file}.1`)
    }
    appendFileSync(file, `${new Date().toISOString()} ${line}\n`)
  } catch {
    /* diagnostics are best-effort */
  }
}
