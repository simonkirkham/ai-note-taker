import { test, expect } from '@playwright/test'
import { formatStep, formatSessionStart, logPath, appendLog, MAX_LOG_BYTES } from '../src/localLog'
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

// BUG-65 — an installed desktop build is otherwise unobservable: whisper-server's stdout is not
// captured and console output needs DevTools. This log is the only channel by which a user can hand
// over real numbers, so its format is asserted rather than assumed.

test('a step line carries the realtime factor — the number that says whether it can keep pace', () => {
  const line = formatStep({ windowMs: 4000, inferenceMs: 2000, committedChars: 120, dropped: 1 })

  expect(line).toContain('window=4000ms')
  expect(line).toContain('infer=2000ms')
  expect(line).toContain('rtf=0.50') // inference took half the audio's duration → keeping pace
  expect(line).toContain('dropped=1')
})

test('an rtf above 1 is visible as such — inference slower than the audio it covers', () => {
  expect(formatStep({ windowMs: 4000, inferenceMs: 9000, committedChars: 0, dropped: 3 })).toContain('rtf=2.25')
})

test('a zero-length window does not produce NaN', () => {
  expect(formatStep({ windowMs: 0, inferenceMs: 10, committedChars: 0, dropped: 0 })).toContain('rtf=n/a')
})

test('the session header carries the machine and the tuning constants', () => {
  const line = formatSessionStart({
    cores: 4,
    threads: 2,
    audioCtx: 768,
    maxWindowMs: 4000,
    hardWindowMs: 8000,
    model: '/models/ggml-base.en.bin',
  })

  expect(line).toContain('cores=4')
  expect(line).toContain('threads=2')
  expect(line).toContain('audioCtx=768')
  expect(line).toContain('maxWindow=4000ms')
  expect(line).toContain('model=ggml-base.en.bin') // basename only — never the user's full path
})

test('appendLog writes a timestamped line and creates the file', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'locallog-'))
  appendLog(dir, 'hello')

  const body = readFileSync(logPath(dir), 'utf8')
  expect(body).toMatch(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z hello\n$/)
})

test('the log rotates rather than growing without bound', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'locallog-'))
  writeFileSync(logPath(dir), 'x'.repeat(MAX_LOG_BYTES + 1))

  appendLog(dir, 'after rotation')

  expect(existsSync(`${logPath(dir)}.1`)).toBe(true)
  expect(readFileSync(logPath(dir), 'utf8')).toContain('after rotation')
})

test('a diagnostic can never break a recording', () => {
  // An unwritable directory must not throw into the streaming session.
  expect(() => appendLog('/nonexistent/definitely/not/here', 'x')).not.toThrow()
})

// BUG-65 — the two branches added for failures and for the send clamp had no format-level test:
// the session specs assert the stat OBJECT, not the line that actually reaches the log. This file's
// premise is that the format is asserted rather than assumed, so assert it.

test('a failed step renders as FAILED, carrying the window and the error', () => {
  const line = formatStep({
    windowMs: 13824,
    inferenceMs: 20001,
    committedChars: 42,
    dropped: 4,
    error: 'The operation was aborted due to timeout',
  })

  expect(line).toContain('step FAILED')
  expect(line).toContain('window=13824ms')
  expect(line).toContain('elapsed=20001ms')
  expect(line).toContain('err=The operation was aborted due to timeout')
})

test('a clamped step reports the withheld audio, and an unclamped one stays quiet', () => {
  const clamped = formatStep({ windowMs: 13824, inferenceMs: 9000, committedChars: 10, dropped: 0, clampedMs: 4200 })
  expect(clamped).toContain('clamped=4200ms')

  const normal = formatStep({ windowMs: 4000, inferenceMs: 1000, committedChars: 10, dropped: 0, clampedMs: 0 })
  expect(normal).not.toContain('clamped')
})
