import { test, expect } from '@playwright/test'
import { createServer, type Server } from 'node:http'
import { probeAlive } from '../src/whisperServer'

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
