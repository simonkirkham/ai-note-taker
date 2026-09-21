import { test, expect } from '@playwright/test'
import { createServer, type Server } from 'node:http'
import { probeAlive, shouldReplaceWarmServer, shouldDiscardShared } from '../src/whisperServer'
import { isHangFailure } from '../src/streamingSession'
import {
  discardIfCurrent,
  __setSharedServerForTest,
  __getSharedServerForTest,
} from '../src/localTranscriptionIpc'
import type { WhisperServer } from '../src/whisperServer'

// BUG-88 — on 2026-09-21 the engine was still running, still holding its port, and still answering
// nothing more than two hours after a meeting. `running` only asks whether the process exists, so
// that corpse read as healthy and would have been handed to the next recording. These specs pin the
// only question worth asking: does it ANSWER?
//
// Deliberately real sockets, not a stub. The failure was a server that accepted the connection and
// then went silent — a stubbed fetch cannot reproduce "accepted but never answered", which is the
// entire property under test.

function listen(handler: (res: { end: (b?: string) => void }) => void): Promise<{ port: number; close: () => void }> {
  return new Promise((resolve) => {
    const srv: Server = createServer((_req, res) => handler(res))
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      resolve({ port, close: () => srv.close() })
    })
  })
}

test('BUG-88: a server that answers is judged alive', async () => {
  const srv = await listen((res) => res.end('ok'))
  try {
    expect(await probeAlive(srv.port, 2000)).toBe(true)
  } finally {
    srv.close()
  }
})

test('BUG-88: a server that accepts the connection but never answers is judged dead', async () => {
  // The exact 2026-09-21 state: the socket connects, the request is accepted, nothing comes back.
  const srv = await listen(() => {
    /* deliberately never responds */
  })
  try {
    const started = Date.now()
    expect(await probeAlive(srv.port, 800)).toBe(false)
    // And it must give that answer promptly — a health check that itself hangs is the bug again,
    // one layer up, delaying the start of every recording.
    expect(Date.now() - started).toBeLessThan(4000)
  } finally {
    srv.close()
  }
})

test('BUG-88: a port with nothing listening is judged dead', async () => {
  const srv = await listen((res) => res.end('ok'))
  const port = srv.port
  srv.close()
  await new Promise((r) => setTimeout(r, 100))
  expect(await probeAlive(port, 2000)).toBe(false)
})

test('BUG-88: a warm engine that is still LOADING is never thrown away', () => {
  // The first version of this check asked isResponsive() of any live process. An engine mid-model-
  // load has a live process and answers nothing yet, so it answered "dead" — and a second
  // recording started during that load would have killed a perfectly healthy engine and leaked it.
  expect(shouldReplaceWarmServer({ running: true, ready: false, answers: false })).toBe(false)
})

test('BUG-88: a ready engine that answers nothing is replaced', () => {
  expect(shouldReplaceWarmServer({ running: true, ready: true, answers: false })).toBe(true)
})

test('BUG-88: a ready engine that answers is left alone', () => {
  expect(shouldReplaceWarmServer({ running: true, ready: true, answers: true })).toBe(false)
})

test('BUG-88: a dead process is not "replaced" — the caller spawns instead', () => {
  expect(shouldReplaceWarmServer({ running: false, ready: false, answers: false })).toBe(false)
})

test('BUG-88: a recovery landing after a restart does not drop the NEW engine', () => {
  // The 2026-09-21 sequence: hang, user stops, user starts again, the old recording's recovery
  // finally lands. It must not clear the shared slot that now holds the new recording's engine.
  const oldEngine = {}
  const newEngine = {}
  expect(shouldDiscardShared(newEngine, oldEngine)).toBe(false)
})

test('BUG-88: a recovery for the engine still in the shared slot does drop it', () => {
  const engine = {}
  expect(shouldDiscardShared(engine, engine)).toBe(true)
})

test('BUG-88: a real /inference timeout rejects with name "TimeoutError"', async () => {
  // POSITIVE CONTROL for the recovery discriminator. streamingSession decides "jammed, replace the
  // engine" from the error NAME, so if this name is not what a genuinely hung request produces, the
  // headline fix silently never fires. Proven against a real socket that accepts and never answers
  // — the actual 2026-09-21 state — not against an assumption about what fetch throws.
  const srv = await listen(() => {
    /* never responds */
  })
  try {
    let caught: unknown
    try {
      await fetch(`http://127.0.0.1:${srv.port}/inference`, {
        method: 'POST',
        signal: AbortSignal.timeout(300),
      })
    } catch (err) {
      caught = err
    }
    expect((caught as { name?: string })?.name).toBe('TimeoutError')
    // And join it to the decision: the predicate must agree with what a real hang actually throws,
    // or the recovery silently never fires. Asserting the name alone leaves that link to two
    // matching string literals in two files.
    expect(isHangFailure(caught)).toBe(true)
  } finally {
    srv.close()
  }
})

test('BUG-88: a 500 from the engine does NOT look like a hang', async () => {
  // The other side of the same control: an erroring engine must be distinguishable, or finding 3
  // comes back and every 500 costs a model reload mid-meeting.
  const srv = await listen((res) => {
    const r = res as unknown as { statusCode: number; end: (b?: string) => void }
    r.statusCode = 500
    r.end('nope')
  })
  try {
    const res = await fetch(`http://127.0.0.1:${srv.port}/inference`, {
      method: 'POST',
      signal: AbortSignal.timeout(2000),
    })
    expect(res.ok).toBe(false)
    // The throw site builds exactly this; feed it to the same predicate rather than asserting
    // that `new Error(...).name === 'Error'`, which cannot fail.
    expect(isHangFailure(new Error(`whisper-server /inference ${res.status}`))).toBe(false)
    expect(isHangFailure(new SyntaxError('Unexpected token'))).toBe(false)
  } finally {
    srv.close()
  }
})

function fakeEngine(): WhisperServer & { killed: number } {
  const e = { killed: 0, kill() { e.killed++ } }
  return e as unknown as WhisperServer & { killed: number }
}

test('BUG-88: replacing the engine in the shared slot clears the slot', () => {
  const current = fakeEngine()
  __setSharedServerForTest(current)
  discardIfCurrent(current)
  expect(current.killed).toBe(1)
  expect(__getSharedServerForTest()).toBeNull()
})

test('BUG-88: a late recovery kills its OWN engine and leaves the new one in place', () => {
  // The orphan half. Without the else-branch the stale engine would be left running with a model
  // resident and nothing that ever kills it, because only the shared slot is torn down on quit.
  const current = fakeEngine()
  const stale = fakeEngine()
  __setSharedServerForTest(current)
  discardIfCurrent(stale)
  expect(stale.killed).toBe(1)
  expect(current.killed).toBe(0)
  expect(__getSharedServerForTest()).toBe(current)
  __setSharedServerForTest(null)
})
