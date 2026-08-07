import { test, expect } from '@playwright/test'
import path from 'node:path'
import { whisperBinPath, whisperServerBinPath } from '../src/modelStore'

// BUG-56 — the resident live path and the batch passes use DIFFERENT binaries from the same
// bundle: whisper-server(.exe) answers /inference over HTTP, whisper-cli(.exe) runs one-shot
// passes. BUG-53 wired the server to whisperBinPath (the CLI), which rejects --host/--port and
// exits immediately — so the live transcript never appeared. These assert the two resolve apart.

const RES = path.join('C:', 'app', 'resources')

// These specs must clear the overrides to see the bundled defaults, but the runner uses a single
// worker (playwright.config.ts) so every spec file shares this process — forcing a literal would
// leak. whisperServer.integration.spec.ts reads WHISPER_SERVER_BIN at MODULE scope to decide
// whether to run at all, so deleting it here would silently turn the only real-binary proof into
// a permanently-skipped no-op that still reports green. Snapshot and restore instead.
const saved = { bin: process.env.WHISPER_BIN, server: process.env.WHISPER_SERVER_BIN }

function restore(name: 'WHISPER_BIN' | 'WHISPER_SERVER_BIN', value: string | undefined): void {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}

test.beforeEach(() => {
  delete process.env.WHISPER_BIN
  delete process.env.WHISPER_SERVER_BIN
})

test.afterEach(() => {
  restore('WHISPER_BIN', saved.bin)
  restore('WHISPER_SERVER_BIN', saved.server)
})

const serverExe = process.platform === 'win32' ? 'whisper-server.exe' : 'whisper-server'

test('the server binary is whisper-server, not the CLI', () => {
  expect(whisperServerBinPath(RES)).toBe(path.join(RES, 'whisper', serverExe))
  expect(whisperServerBinPath(RES)).not.toBe(whisperBinPath(RES))
})

test('the server and CLI binaries are siblings in the bundled whisper dir', () => {
  expect(path.dirname(whisperServerBinPath(RES))).toBe(path.dirname(whisperBinPath(RES)))
  expect(path.dirname(whisperServerBinPath(RES))).toBe(path.join(RES, 'whisper'))
})

test('WHISPER_SERVER_BIN overrides the server path for dev/integration runs', () => {
  process.env.WHISPER_SERVER_BIN = '/tmp/custom/whisper-server'
  expect(whisperServerBinPath(RES)).toBe('/tmp/custom/whisper-server')
})

test('WHISPER_BIN does not redirect the server path', () => {
  // The CLI override must not silently become the server override — that is exactly the
  // conflation that shipped in BUG-53. Assert the positive, so this cannot pass for a wrong value.
  process.env.WHISPER_BIN = '/tmp/custom/whisper-cli'
  expect(whisperServerBinPath(RES)).toBe(path.join(RES, 'whisper', serverExe))
})
