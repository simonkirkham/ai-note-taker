import { test, expect } from '@playwright/test'
import path from 'node:path'
import { whisperBinPath, whisperServerBinPath } from '../src/modelStore'

// BUG-56 — the resident live path and the batch passes use DIFFERENT binaries from the same
// bundle: whisper-server(.exe) answers /inference over HTTP, whisper-cli(.exe) runs one-shot
// passes. BUG-53 wired the server to whisperBinPath (the CLI), which rejects --host/--port and
// exits immediately — so the live transcript never appeared. These assert the two resolve apart.

const RES = path.join('C:', 'app', 'resources')

test.afterEach(() => {
  delete process.env.WHISPER_BIN
  delete process.env.WHISPER_SERVER_BIN
})

test('the server binary is whisper-server, not the CLI', () => {
  delete process.env.WHISPER_BIN
  delete process.env.WHISPER_SERVER_BIN
  const server = whisperServerBinPath(RES)
  expect(path.basename(server)).toMatch(/^whisper-server(\.exe)?$/)
  expect(path.basename(server)).not.toMatch(/whisper-cli/)
})

test('the server and CLI binaries are siblings in the bundled whisper dir', () => {
  delete process.env.WHISPER_BIN
  delete process.env.WHISPER_SERVER_BIN
  expect(path.dirname(whisperServerBinPath(RES))).toBe(path.dirname(whisperBinPath(RES)))
  expect(path.dirname(whisperServerBinPath(RES))).toBe(path.join(RES, 'whisper'))
})

test('WHISPER_SERVER_BIN overrides the server path for dev/integration runs', () => {
  process.env.WHISPER_SERVER_BIN = '/tmp/custom/whisper-server'
  expect(whisperServerBinPath(RES)).toBe('/tmp/custom/whisper-server')
})

test('WHISPER_BIN does not redirect the server path', () => {
  // The CLI override must not silently become the server override — that is exactly the
  // conflation that shipped in BUG-53.
  process.env.WHISPER_BIN = '/tmp/custom/whisper-cli'
  expect(whisperServerBinPath(RES)).not.toBe('/tmp/custom/whisper-cli')
})
