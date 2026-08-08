import { test, expect } from '@playwright/test'
import { StreamingSession, READY_TIMEOUT_MS } from '../src/streamingSession'
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
  expect(READY_TIMEOUT_MS).toBeLessThan(SERVER_START_TIMEOUT_MS)
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

test('a mid-recording crash is reported by the STEP timer, with the same wording as the stop path', async () => {
  // The step()-detected branch is the one that fires while the user is still recording. It must not
  // produce different text from the stop-detected branch for the identical condition, and must not
  // name an internal binary.
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
  await waitMs(1700) // one step observes a healthy server → sawReady
  Object.defineProperty(server, 'running', { value: false, configurable: true })
  await waitMs(1700) // the next step notices it is gone — no stop() involved
  session.dispose()

  expect(errors.length).toBe(1)
  expect(errors[0].message).toMatch(/stopped during the recording/i)
  expect(errors[0].message).not.toMatch(/whisper/i)
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

// BUG-65 — the diagnostic must cover the failure shape it exists to diagnose, and the send cap
// must actually hold on the slow machine that has the bug.

test('a failed step still writes a diagnostic line — a run of timeouts must not be silent', async () => {
  const stats: { inferenceMs: number; windowMs: number; error?: string }[] = []
  const server = stubServer({ running: true, ready: true })
  ;(server as unknown as { transcribe: () => Promise<never> }).transcribe = () =>
    Promise.reject(new Error('The operation was aborted due to timeout'))
  const session = new StreamingSession(server, () => {}, () => {}, undefined, {
    readyTimeoutMs: 60_000,
    onStep: (s) => stats.push({ inferenceMs: s.inferenceMs, windowMs: s.windowMs, error: s.error }),
  })
  session.start()
  session.pushPcm(pcm)
  await waitMs(1700)
  session.dispose()

  expect(stats.length).toBeGreaterThan(0)
  expect(stats[0].error).toMatch(/aborted due to timeout/i)
  // Real numbers, not sentinels: how long the step ran before failing and how much audio it was
  // carrying are both part of the diagnosis — a 20s /inference abort looks nothing like an
  // instant 500, and the window size says whether the send clamp was engaged when it died.
  expect(stats[0].inferenceMs).toBeGreaterThanOrEqual(0)
  expect(stats[0].windowMs).toBeGreaterThan(0)
})

test('the window sent to the engine is capped, and the withheld audio is reported', async () => {
  const sent: number[] = []
  const server = stubServer({ running: true, ready: true })
  ;(server as unknown as { transcribe: (p: Buffer) => Promise<never[]> }).transcribe = (p: Buffer) => {
    sent.push(p.length)
    return Promise.resolve([])
  }
  const stats: { clampedMs: number }[] = []
  const session = new StreamingSession(server, () => {}, () => {}, undefined, {
    readyTimeoutMs: 60_000,
    maxSendWindowMs: 1000, // 1s cap
    onStep: (s) => stats.push({ clampedMs: s.clampedMs }),
  })
  session.start()
  session.pushPcm(Buffer.alloc(32 * 5000)) // 5s of audio against a 1s cap
  await waitMs(1700)
  session.dispose()

  expect(sent.length).toBeGreaterThan(0)
  expect(sent[0]).toBe(32 * 1000) // exactly the cap, not the whole 5s
  expect(stats[0].clampedMs).toBe(4000) // and the 4s withheld is visible in the log
})

test('a throwing diagnostic cannot break the recording', async () => {
  const errors: Error[] = []
  const session = new StreamingSession(
    stubServer({ running: true, ready: true }),
    () => {},
    (e) => errors.push(e),
    undefined,
    {
      readyTimeoutMs: 60_000,
      onStep: () => {
        throw new Error('log volume full')
      },
    },
  )
  session.start()
  session.pushPcm(pcm)
  await waitMs(5000) // well past FAIL_THRESHOLD steps

  session.dispose()
  // A throwing onStep must not count as an inference failure, or it raises a false banner.
  expect(errors).toEqual([])
})
