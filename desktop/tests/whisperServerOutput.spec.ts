import { test, expect } from '@playwright/test'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { WhisperServer } from '../src/whisperServer'

// BUG-88 — the live transcript died after EXACTLY ~250 steps in every engine lifetime on record
// (five, across three meetings). whisper-server prints a few hundred bytes to stdout/stderr per
// /inference. WhisperServer spawned it with piped stdio and never read either pipe, so once the OS
// pipe buffer filled the engine blocked forever inside a write — mid-request, holding the lock every
// other request waits on. Reproduced against the real binary with desktop/scripts/whisper-server-soak.mjs.
//
// The fake engine below does what the real one does: it writes to its output on every request with
// a BLOCKING write. That is the property under test — a pipe nobody drains blocks the writer — so a
// stub that never touches its stdio could not fail this spec. Each request writes 64 KB so the
// buffer fills in a handful of requests rather than 250.
const FAKE_ENGINE = `
const http = require('node:http')
const fs = require('node:fs')
const port = Number(process.argv[process.argv.indexOf('--port') + 1])
const noise = 'x'.repeat(64 * 1024 - 1) + '\\n'
http
  .createServer((req, res) => {
    req.resume()
    req.on('end', () => {
      if (req.url !== '/inference') {
        res.statusCode = 404
        res.end()
        return
      }
      fs.writeSync(1, noise) // blocks once the parent stops reading, exactly like printf in whisper-server
      fs.writeSync(2, noise)
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ segments: [{ start: 0, end: 1, text: 'hello' }] }))
    })
  })
  .listen(port, '127.0.0.1')
`

const REQUESTS = 40
const PER_REQUEST_DEADLINE_MS = 5_000

test.describe('BUG-88: the live engine survives a long meeting', () => {
  // The fake engine is launched through a shebang, which Windows does not honour. CI is Linux.
  test.skip(process.platform === 'win32', 'shebang-launched fake engine')
  test.setTimeout(120_000)

  let dir = ''
  let bin = ''
  test.beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'fake-whisper-'))
    bin = path.join(dir, 'fake-whisper-server')
    writeFileSync(bin, `#!${process.execPath}\n${FAKE_ENGINE}`)
    chmodSync(bin, 0o755)
  })
  test.afterAll(() => rmSync(dir, { recursive: true, force: true }))

  test('an engine that writes output on every request keeps answering far past its output buffer', async () => {
    const server = new WhisperServer(bin, 'unused-model.bin', 1)
    await server.start()
    let answered = 0
    try {
      for (let i = 0; i < REQUESTS; i++) {
        let deadline: ReturnType<typeof setTimeout> | undefined
        try {
          const segs = await Promise.race([
            server.transcribe(Buffer.alloc(3200), 0),
            new Promise<never>((_, reject) => {
              deadline = setTimeout(
                () => reject(new Error(`request #${i + 1} never answered after ${answered} successes`)),
                PER_REQUEST_DEADLINE_MS,
              )
            }),
          ])
          expect(segs[0]?.text).toBe('hello')
        } finally {
          clearTimeout(deadline)
        }
        answered++
      }
    } finally {
      server.kill()
    }
    expect(answered).toBe(REQUESTS)
  })
})
