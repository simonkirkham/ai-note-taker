// BUG-88 — soak the resident whisper-server with /inference requests, outside the app and without
// a meeting, to find how many requests one instance survives. Run with the WINDOWS node against the
// installed bundle, e.g. from PowerShell:
//
//   node desktop/scripts/whisper-server-soak.mjs --requests 400
//
// Options:
//   --requests N      how many /inference requests to send (default 400)
//   --client fetch    the app's own path: global fetch + FormData (default)
//   --client close    node:http, a fresh connection per request (Connection: close)
//   --client keepalive node:http through one keep-alive agent
//   --probe-every N   send a GET / every N requests, as the app does at start (default 0 = never)
//   --bin / --model   override the installed binary / live model
//   --stdio MODE      what happens to the server's stdout/stderr:
//                       unread  piped and never read — what WhisperServer did before the fix
//                       drain   piped and read (default)
//                       ignore  not piped at all — the fix
//   --threads N       server -t (default 6, what the app picks on a 12-core machine)
//   --seconds S       audio length per request (default 6)
//
// Prints one line per 25 requests and a final verdict; exit 0 when every request answered.

import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : dflt
}
const REQUESTS = Number(arg('requests', 400))
const CLIENT = arg('client', 'fetch')
const PROBE_EVERY = Number(arg('probe-every', 0))
const THREADS = arg('threads', '6')
const SECONDS = Number(arg('seconds', 6))
const STDIO = arg('stdio', 'drain')
const home = os.homedir()
const BIN = arg('bin', path.join(home, 'AppData/Local/Programs/ai-note-taker-desktop/resources/whisper/whisper-server.exe'))
const MODEL = arg('model', path.join(home, 'AppData/Roaming/ai-note-taker-desktop/models/ggml-base.en.bin'))
const TIMEOUT_MS = 20_000

function freePort() {
  return new Promise((resolve, reject) => {
    const s = createServer()
    s.once('error', reject)
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port
      s.close(() => resolve(p))
    })
  })
}

// 16 kHz mono 16-bit WAV of low-level noise plus a tone — enough for whisper to run a full encode.
function wav(seconds) {
  const n = 16000 * seconds
  const b = Buffer.alloc(44 + n * 2)
  b.write('RIFF', 0)
  b.writeUInt32LE(36 + n * 2, 4)
  b.write('WAVEfmt ', 8)
  b.writeUInt32LE(16, 16)
  b.writeUInt16LE(1, 20)
  b.writeUInt16LE(1, 22)
  b.writeUInt32LE(16000, 24)
  b.writeUInt32LE(32000, 28)
  b.writeUInt16LE(2, 32)
  b.writeUInt16LE(16, 34)
  b.write('data', 36)
  b.writeUInt32LE(n * 2, 40)
  for (let i = 0; i < n; i++) {
    const v = Math.sin((2 * Math.PI * 220 * i) / 16000) * 3000 + (Math.random() - 0.5) * 2000
    b.writeInt16LE(Math.round(v), 44 + i * 2)
  }
  return b
}

const audio = wav(SECONDS)
const port = await freePort()
const args = ['-m', MODEL, '--host', '127.0.0.1', '--port', String(port), '-t', THREADS, '--audio-ctx', '768']
const proc = spawn(BIN, args, STDIO === 'ignore' ? { stdio: 'ignore' } : {})
let stderrTail = ''
const bytes = { out: 0, err: 0 }
const keep = (which) => (d) => {
  bytes[which] += d.length
  stderrTail = (stderrTail + d.toString()).slice(-4000)
}
if (STDIO === 'drain') {
  proc.stdout.on('data', keep('out'))
  proc.stderr.on('data', keep('err'))
}
proc.on('exit', (c) => console.log(`server exited code=${c}`))

async function probe(timeoutMs = 5000) {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(timeoutMs) })
    await r.body?.cancel().catch(() => {})
    return true
  } catch {
    return false
  }
}

const deadline = Date.now() + 60_000
while (!(await probe())) {
  if (Date.now() > deadline) throw new Error('server never became ready')
  await new Promise((r) => setTimeout(r, 250))
}
console.log(`ready on ${port} client=${CLIENT} stdio=${STDIO} bin=${BIN}`)

// Same body the app sends (whisperServer.ts transcribe()).
async function viaFetch() {
  const form = new FormData()
  form.append('file', new Blob([new Uint8Array(audio)], { type: 'audio/wav' }), 'w.wav')
  form.append('response_format', 'verbose_json')
  form.append('temperature', '0')
  const res = await fetch(`http://127.0.0.1:${port}/inference`, {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`status ${res.status}`)
  await res.json()
}

const keepAliveAgent = new http.Agent({ keepAlive: true, maxSockets: 1 })
function viaHttp(agent) {
  const boundary = '----soak' + Math.random().toString(16).slice(2)
  const part = (name, value) => `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="w.wav"\r\nContent-Type: audio/wav\r\n\r\n`,
    ),
    audio,
    Buffer.from('\r\n' + part('response_format', 'verbose_json') + part('temperature', '0') + `--${boundary}--\r\n`),
  ])
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: '/inference',
        method: 'POST',
        agent,
        headers: {
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': body.length,
          ...(agent === false ? { Connection: 'close' } : {}),
        },
        timeout: TIMEOUT_MS,
      },
      (res) => {
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => (res.statusCode === 200 ? resolve() : reject(new Error(`status ${res.statusCode}`))))
      },
    )
    req.on('timeout', () => req.destroy(Object.assign(new Error('timeout'), { name: 'TimeoutError' })))
    req.on('error', reject)
    req.end(body)
  })
}

const send = CLIENT === 'fetch' ? viaFetch : CLIENT === 'close' ? () => viaHttp(false) : () => viaHttp(keepAliveAgent)

let ok = 0
let probes = 0
const started = Date.now()
let lastMs = 0
for (let i = 1; i <= REQUESTS; i++) {
  if (PROBE_EVERY > 0 && i % PROBE_EVERY === 0) {
    probes++
    await probe()
  }
  const t = Date.now()
  try {
    await send()
    ok++
    lastMs = Date.now() - t
  } catch (e) {
    console.log(`FAILED at request #${i} after ${ok} successes (${Date.now() - t}ms): ${e.name}: ${e.message}`)
    const alive = await probe(3000)
    console.log(`GET / afterwards answers: ${alive}`)
    console.log('--- server output tail ---\n' + stderrTail.split('\n').slice(-15).join('\n'))
    proc.kill()
    process.exit(1)
  }
  if (i % 25 === 0) console.log(`#${i} ok=${ok} last=${lastMs}ms elapsed=${Math.round((Date.now() - started) / 1000)}s stdout=${bytes.out}B stderr=${bytes.err}B`)
}
console.log(`PASS: ${ok}/${REQUESTS} answered (probes=${probes}) in ${Math.round((Date.now() - started) / 1000)}s`)
proc.kill()
process.exit(0)
