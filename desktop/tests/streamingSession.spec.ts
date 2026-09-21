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

// BUG-67 — once PCM stops arriving the session re-transcribed the SAME window every tick, forever.
// MIN_NEW_MS did not catch it: it gates on `byteLen - startByte`, which is the WINDOW SIZE, not what
// has arrived since the last step. Real-world cost: after Stop, the renderer awaits diarize (two
// whisper-cli passes) before anything halts the live session, so the spin competed for cores with
// the pass the user was waiting for — 12 frozen steps and inference climbing 1.1s → 3.0s in the log.

function countingServer(): { server: WhisperServer; calls: () => number } {
  let calls = 0
  const server = stubServer({ running: true, ready: true })
  ;(server as unknown as { transcribe: () => Promise<never[]> }).transcribe = () => {
    calls++
    return Promise.resolve([])
  }
  return { server, calls: () => calls }
}

test('a session receiving no new audio stops re-transcribing the same window', async () => {
  const { server, calls } = countingServer()
  const session = new StreamingSession(server, () => {}, () => {}, undefined, { readyTimeoutMs: 60_000 })
  session.start()
  session.pushPcm(Buffer.alloc(32 * 4000)) // 4s, then the audio stops (Stop pressed)
  await waitMs(1700)
  const afterFirst = calls()
  await waitMs(5000) // three more ticks with nothing new arriving

  session.dispose()
  expect(afterFirst).toBeGreaterThan(0) // it did transcribe the audio it had
  expect(calls()).toBe(afterFirst) // and then stopped, rather than spinning on it
})

test('new audio resumes stepping, and the guard then re-arms', async () => {
  const { server, calls } = countingServer()
  const session = new StreamingSession(server, () => {}, () => {}, undefined, { readyTimeoutMs: 60_000 })
  session.start()
  session.pushPcm(Buffer.alloc(32 * 4000))
  await waitMs(1700)
  const afterFirst = calls()

  session.pushPcm(Buffer.alloc(32 * 2000)) // the user starts speaking again
  await waitMs(1700)
  const afterResume = calls()

  // The resume assertion ALONE passes with the guard removed entirely — it is a latch-regression
  // check, not proof of the fix. Going flat again at the new byteLen is what proves it re-arms.
  await waitMs(3400)

  session.dispose()
  expect(afterResume).toBeGreaterThan(afterFirst)
  expect(calls()).toBe(afterResume)
})

// BUG-67 regression guard for BUG-65's clamp. A step consumes up to the SEND CAP, not everything
// buffered — the clamp deliberately makes the withheld tail "wait a step". If the idle guard marks
// all buffered bytes as consumed, that tail is never transcribed live once audio stops: the two
// fixes cancel out, silently, at exactly the end-of-audio case the clamp exists for.
test('a clamped step does not mark the withheld tail as consumed', async () => {
  const sent: number[] = []
  const server = stubServer({ running: true, ready: true })
  ;(server as unknown as { transcribe: (p: Buffer) => Promise<never[]> }).transcribe = (p: Buffer) => {
    sent.push(p.length)
    return Promise.resolve([])
  }
  const session = new StreamingSession(server, () => {}, () => {}, undefined, {
    readyTimeoutMs: 60_000,
    // ABOVE hardWindowMs (8000), matching production, where MAX_SEND_WINDOW_MS is 13824. A cap
    // BELOW it would mean a clamped window never reaches `forced`, so finalizedMs never advances,
    // clampedMs stays > 0 and lastStepByteLen stays pinned — the session spins and this spec passes
    // ON that spin, asserting the absence of the symptom while demonstrating it. The ordering is
    // locked by serverArgs.spec.ts ("the runaway guard can actually fire").
    maxSendWindowMs: 9000, // 12s buffered → 3s withheld on the first step
  })
  session.start()
  session.pushPcm(Buffer.alloc(32 * 12000))
  await waitMs(3400) // two ticks: the clamped window, then the withheld tail
  const drained = sent.length
  await waitMs(3400) // two more with nothing new arriving

  session.dispose()
  // It works through the backlog rather than stopping after the first clamped step...
  expect(drained).toBeGreaterThan(1)
  // ...and then goes idle, rather than spinning on the tail forever.
  expect(sent.length).toBe(drained)
})

// BUG-88 — the engine can stop answering from a perfectly healthy state and never recover. On
// 2026-09-21 it hung 7m52s into a meeting, was still hung two hours later, and the recording lost
// 8-10 minutes because the only remedy was for a human to notice and restart in the cloud. These
// specs pin the behaviour that makes a hang cost seconds instead of the rest of the meeting:
// replace the engine rather than report and keep hammering it.
//
// Every one of these feeds audio CONTINUOUSLY. Pushing one buffer and waiting is not a meeting: the
// BUG-67 idle guard then halts the session by itself, and the spec passes without the fix ever
// running. Three of these were written that way first and passed green on unfixed code.

// The specs assert the failure ACCOUNTING (a count of consecutive failures), which is independent
// of how fast the steps come. Running it at production cadence cost ~81s of CI for no extra proof.
const FAST_STEP = 150

// Feed PCM the way a live recording does, until stopped.
function feedAudio(session: StreamingSession): () => void {
  const t = setInterval(() => session.pushPcm(pcm), 200)
  return () => clearInterval(t)
}

// A server whose /inference never succeeds, counting how many requests it was sent.
function deadServer(): WhisperServer & { calls: number } {
  const s = {
    running: true,
    ready: true,
    calls: 0,
    transcribe() {
      s.calls++
      // Same shape a real aborted /inference produces; whisperServerHealth.spec.ts pins that name
      // against a real socket, so these stubs cannot drift from the thing they stand in for.
      return Promise.reject(new DOMException('The operation was aborted due to timeout', 'TimeoutError'))
    },
    kill: () => {},
  }
  return s as unknown as WhisperServer & { calls: number }
}

// An engine that is ERRORING rather than jammed: it fails fast, the way a 500 or a malformed body
// does. A replacement would return exactly the same thing.
function erroringServer(): WhisperServer & { calls: number } {
  const s = {
    running: true,
    ready: true,
    calls: 0,
    transcribe() {
      s.calls++
      return Promise.reject(new Error('whisper-server /inference 500'))
    },
    kill: () => {},
  }
  return s as unknown as WhisperServer & { calls: number }
}

// A server that answers normally, so a recovered session visibly produces text again.
function liveServer(text: string): WhisperServer & { calls: number } {
  const s = {
    running: true,
    ready: true,
    calls: 0,
    transcribe(_pcm: Buffer, baseMs: number) {
      s.calls++
      return Promise.resolve([{ startMs: baseMs, endMs: baseMs + 400, text }])
    },
    kill: () => {},
  }
  return s as unknown as WhisperServer & { calls: number }
}

test('BUG-88: a hung engine is replaced mid-recording and the live transcript resumes', async () => {
  const dead = deadServer()
  const fresh = liveServer('back again')
  const live: string[] = []
  const errors: Error[] = []
  const session = new StreamingSession(
    dead,
    (t) => live.push(t),
    (e) => errors.push(e),
    undefined,
    { readyTimeoutMs: 60_000, stepMs: FAST_STEP, onRecover: async () => fresh },
  )
  session.start()
  const stop = feedAudio(session)
  await waitMs(2500)
  stop()
  session.dispose()

  // The whole point: words appear again without anyone intervening.
  expect(fresh.calls).toBeGreaterThan(0)
  expect(live.join(' ')).toMatch(/back again/)
  // And a recovery the user never had to act on is not an error they need to read.
  expect(errors).toEqual([])
})

test('BUG-88: the hung engine stops receiving requests once it has been replaced', async () => {
  const dead = deadServer()
  const fresh = liveServer('ok')
  const session = new StreamingSession(dead, () => {}, () => {}, undefined, {
    readyTimeoutMs: 60_000,
    stepMs: FAST_STEP,
    onRecover: async () => fresh,
  })
  session.start()
  const stop = feedAudio(session)
  await waitMs(2000)
  const afterRecovery = dead.calls
  await waitMs(1500)
  stop()
  session.dispose()

  // Every extra request to a jammed engine is what made today's hang permanent: whisper-server
  // serialises inference, so abandoned requests pile up until even a trivial GET stops answering.
  expect(dead.calls).toBe(afterRecovery)
  expect(fresh.calls).toBeGreaterThan(0)
})

test('BUG-88: when no replacement can be started the user is told, once', async () => {
  const errors: Error[] = []
  const session = new StreamingSession(deadServer(), () => {}, (e) => errors.push(e), undefined, {
    readyTimeoutMs: 60_000,
    stepMs: FAST_STEP,
    onRecover: async () => null,
  })
  session.start()
  const stop = feedAudio(session)
  await waitMs(2500)
  stop()
  session.dispose()

  expect(errors.length).toBe(1)
  expect(errors[0].message).toMatch(/stopped responding/i)
})

test('BUG-88: the session gives up after repeated hangs rather than restarting for ever', async () => {
  let spawned = 0
  const errors: Error[] = []
  const session = new StreamingSession(deadServer(), () => {}, (e) => errors.push(e), undefined, {
    readyTimeoutMs: 60_000,
    stepMs: FAST_STEP,
    maxRecoveries: 2,
    onRecover: async () => {
      spawned++
      return deadServer()
    },
  })
  session.start()
  const stop = feedAudio(session)
  await waitMs(5000)
  stop()
  session.dispose()

  // Restarting an engine costs seconds of CPU and a model load; an engine that hangs three times
  // is not going to be fixed by a fourth attempt, and the machine is being used for a meeting.
  expect(spawned).toBe(2)
  expect(errors.length).toBe(1)
  expect(errors[0].message).toMatch(/stopped responding/i)
})

test('BUG-88: once the live view is declared dead the session stops re-transcribing', async () => {
  const dead = deadServer()
  const session = new StreamingSession(dead, () => {}, () => {}, undefined, {
    readyTimeoutMs: 60_000,
    stepMs: FAST_STEP,
    onRecover: async () => null,
  })
  session.start()
  const stop = feedAudio(session)
  await waitMs(2500)
  const atGiveUp = dead.calls
  // The renderer keeps this session alive while it awaits the stop-time speaker-separation pass —
  // 7m23s on 2026-09-21 — so a session that keeps stepping competes for cores with the very pass
  // the user is waiting on. Once there is nothing useful left to do, it must stop doing it.
  await waitMs(1500)
  stop()
  session.dispose()

  expect(dead.calls).toBe(atGiveUp)
})

test('BUG-88: an engine returning errors is NOT replaced — only a hang is', async () => {
  // A replacement engine returns the same 500, so restarting costs a model load mid-meeting and
  // buys nothing. The earlier version of this gate asked the engine whether it still answered
  // `GET /`; that was self-defeating, because the jam it looks for is caused by requests piling up
  // AFTER the decision point, so `/` still answers then and a real hang would go unreplaced.
  let spawned = 0
  const errors: Error[] = []
  const session = new StreamingSession(erroringServer(), () => {}, (e) => errors.push(e), undefined, {
    readyTimeoutMs: 60_000,
    stepMs: FAST_STEP,
    onRecover: async () => {
      spawned++
      return liveServer('x')
    },
  })
  session.start()
  const stop = feedAudio(session)
  await waitMs(2500)
  stop()
  session.dispose()

  expect(spawned).toBe(0)
  expect(errors.length).toBe(1)
  expect(errors[0].message).toMatch(/stopped responding/i)
})

test('BUG-88: an error in the middle of a run of hangs cannot be laundered into a restart', async () => {
  // Mixed causes are not a jam. Without the reset, two timeouts plus a 500 plus a timeout would
  // reach the threshold and force a pointless model reload.
  let spawned = 0
  let n = 0
  const mixed = {
    running: true,
    ready: true,
    transcribe() {
      n++
      return Promise.reject(
        n % 3 === 0
          ? new Error('whisper-server /inference 500')
          : new DOMException('aborted', 'TimeoutError'),
      )
    },
    kill: () => {},
  } as unknown as WhisperServer
  const session = new StreamingSession(mixed, () => {}, () => {}, undefined, {
    readyTimeoutMs: 60_000,
    stepMs: FAST_STEP,
    onRecover: async () => {
      spawned++
      return liveServer('x')
    },
  })
  session.start()
  const stop = feedAudio(session)
  await waitMs(2500)
  stop()
  session.dispose()

  expect(spawned).toBe(0)
})

test('BUG-88: a replacement arriving after the recording ended is never adopted', async () => {
  // Stop-then-start inside the recovery window is exactly what the user did on 2026-09-21.
  //
  // HONEST LABEL: this passes even with the `disposed` guard inside recoverOrGiveUp removed, which
  // was checked by injection. It holds structurally — dispose() stops the step timer, so nothing
  // runs whatever the recovery resolves to. So what it really guards is the TEARDOWN, not the
  // guard: it would redden if disposal ever stopped clearing the timer. Kept and relabelled rather
  // than presented as coverage of a branch it does not reach.
  const fresh = liveServer('too late')
  const live: string[] = []
  const session = new StreamingSession(deadServer(), (x) => live.push(x), () => {}, undefined, {
    readyTimeoutMs: 60_000,
    stepMs: FAST_STEP,
    onRecover: async () => {
      await waitMs(500) // a real respawn is a model load, not instant
      return fresh
    },
  })
  session.start()
  const stop = feedAudio(session)
  await waitMs(900) // inside the recovery
  session.dispose()
  stop()
  await waitMs(1200) // the replacement lands here, after the session is gone

  expect(fresh.calls).toBe(0)
  expect(live).toEqual([])
})

test('BUG-88: a recovery that never returns still ends in a message, not a silent stall', async () => {
  // The thing being recovered FROM is a hang, so a supplier that never settles is a realistic
  // input. Without a deadline the session sits with recovery latched, reporting nothing, for the
  // rest of the meeting — the original bug reproduced one layer up, and self-concealing.
  const errors: Error[] = []
  const session = new StreamingSession(deadServer(), () => {}, (e) => errors.push(e), undefined, {
    readyTimeoutMs: 60_000,
    stepMs: FAST_STEP,
    recoverTimeoutMs: 600,
    onRecover: () => new Promise<never>(() => {}), // never settles
  })
  session.start()
  const stop = feedAudio(session)
  await waitMs(3000)
  stop()
  session.dispose()

  expect(errors.length).toBe(1)
  expect(errors[0].message).toMatch(/stopped responding/i)
})

