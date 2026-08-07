import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { StreamingSession } from '../src/streamingSession'
import { SERVER_START_TIMEOUT_MS, type WhisperServer } from '../src/whisperServer'

// BUG-56 — step() returns quietly while the server is not ready, deliberately before the
// failure accounting. A server that starts but NEVER reaches ready therefore produced no live
// text and no error, silently, for the whole recording. A ready deadline closes that hole.

type StubOpts = { running?: boolean; ready?: boolean }

function stubServer(opts: StubOpts): WhisperServer {
  return {
    running: opts.running ?? true,
    ready: opts.ready ?? false,
    transcribe: async () => [],
    kill: () => {},
  } as unknown as WhisperServer
}

// 500 ms of 16 kHz 16-bit mono — enough new audio to clear MIN_NEW_MS.
const pcm = Buffer.alloc(32 * 600)

function waitMs(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

test('a server that never becomes ready reports a terminal error once the deadline passes', async () => {
  const errors: Error[] = []
  const session = new StreamingSession(
    stubServer({ running: true, ready: false }),
    () => {},
    (e) => errors.push(e),
    undefined,
    { readyTimeoutMs: 120 },
  )
  session.start()
  session.pushPcm(pcm)
  await waitMs(400)
  session.dispose()

  expect(errors.length).toBeGreaterThan(0)
  expect(errors[0].message).toMatch(/did not finish loading/i)
})

test('the never-ready error is reported only once, not every step', async () => {
  const errors: Error[] = []
  const session = new StreamingSession(
    stubServer({ running: true, ready: false }),
    () => {},
    (e) => errors.push(e),
    undefined,
    { readyTimeoutMs: 80 },
  )
  session.start()
  session.pushPcm(pcm)
  await waitMs(600)
  session.dispose()

  expect(errors.length).toBe(1)
})

test('a server that becomes ready inside the deadline reports nothing', async () => {
  const errors: Error[] = []
  const server = stubServer({ running: true, ready: false })
  const session = new StreamingSession(
    server,
    () => {},
    (e) => errors.push(e),
    undefined,
    { readyTimeoutMs: 500 },
  )
  session.start()
  session.pushPcm(pcm)
  // Model finishes loading well inside the deadline.
  await waitMs(50)
  Object.defineProperty(server, 'ready', { value: true, configurable: true })
  await waitMs(700)
  session.stop()

  expect(errors).toEqual([])
})

test('a server whose process is GONE stays silent — the start-failure channel already reported it', async () => {
  // ensureServer's catch fires an accurate "failed to start" banner within a second. Reporting
  // "did not finish loading" over the top of it 75s later would tell the user the wrong thing.
  const errors: Error[] = []
  const session = new StreamingSession(
    stubServer({ running: false, ready: false }),
    () => {},
    (e) => errors.push(e),
    undefined,
    { readyTimeoutMs: 80 },
  )
  session.start()
  session.pushPcm(pcm)
  await waitMs(400)
  session.stop()

  expect(errors).toEqual([])
})

// The production deadline must be REACHABLE: WhisperServer.start() kills the child and nulls proc
// when it gives up, so a ready deadline at or above that timeout can only ever observe a dead
// process and never fires. The first version of this shipped at 75s against a 60s start timeout —
// dead code that read as a live safety net. This test is the thing that stops it inverting again.
test('the ready deadline is reachable — it fires before the server start timeout kills the process', () => {
  const src = readFileSync(path.join(__dirname, '..', 'src', 'streamingSession.ts'), 'utf8')
  const declared = /const READY_TIMEOUT_MS = ([0-9_]+)/.exec(src)
  expect(declared).not.toBeNull()
  const readyTimeout = Number(declared![1].replace(/_/g, ''))
  expect(readyTimeout).toBeLessThan(SERVER_START_TIMEOUT_MS)
})

test('a never-ready server is reported on stop once the recording ran long enough to expect text', async () => {
  // Otherwise a brief recording ends with an empty live view and no explanation — the original
  // silent failure, just shorter.
  const errors: Error[] = []
  const session = new StreamingSession(
    stubServer({ running: true, ready: false }),
    () => {},
    (e) => errors.push(e),
    undefined,
    { readyTimeoutMs: 60_000, minSessionForStopReportMs: 10 },
  )
  session.start()
  session.pushPcm(pcm)
  await waitMs(60)
  session.stop()

  expect(errors.length).toBe(1)
  expect(errors[0].message).toMatch(/did not finish loading/i)
})

test('a SHORT recording stopped while the model is still loading reports nothing', async () => {
  // The first local recording after launch legitimately spends seconds loading base.en. A 3s
  // recording stopping mid-load is not a fault, and a banner here would sit beside a perfectly
  // good stop-time transcript.
  const errors: Error[] = []
  const session = new StreamingSession(
    stubServer({ running: true, ready: false }),
    () => {},
    (e) => errors.push(e),
    undefined,
    { readyTimeoutMs: 60_000, minSessionForStopReportMs: 20_000 },
  )
  session.start()
  session.pushPcm(pcm)
  await waitMs(50)
  session.stop()

  expect(errors).toEqual([])
})

test('a server that was ready and then died is reported on stop, not silently dropped', async () => {
  // A crash in the last step-interval before stop() would otherwise go unreported: step() never
  // runs again, and the start-failure channel never fires for a server that DID start.
  const errors: Error[] = []
  const server = stubServer({ running: true, ready: true })
  const session = new StreamingSession(
    server,
    () => {},
    (e) => errors.push(e),
    undefined,
    { readyTimeoutMs: 60_000 },
  )
  session.start()
  session.pushPcm(pcm)
  // A step runs and observes a healthy server, then the process dies.
  await waitMs(1700)
  Object.defineProperty(server, 'ready', { value: false, configurable: true })
  Object.defineProperty(server, 'running', { value: false, configurable: true })
  session.stop()

  expect(errors.length).toBe(1)
  expect(errors[0].message).toMatch(/stopped during the recording/i)
})

test('a healthy short recording reports nothing on stop', async () => {
  const errors: Error[] = []
  const session = new StreamingSession(
    stubServer({ running: true, ready: true }),
    () => {},
    (e) => errors.push(e),
    undefined,
    { readyTimeoutMs: 60_000 },
  )
  session.start()
  session.pushPcm(pcm)
  await waitMs(50)
  session.stop()

  expect(errors).toEqual([])
})

test('a disposed session never reports a ready timeout', async () => {
  const errors: Error[] = []
  const session = new StreamingSession(
    stubServer({ running: true, ready: false }),
    () => {},
    (e) => errors.push(e),
    undefined,
    { readyTimeoutMs: 60 },
  )
  session.start()
  session.pushPcm(pcm)
  session.dispose()
  await waitMs(300)

  expect(errors).toEqual([])
})
