import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import path from 'node:path'

// 31-C — assert the electron-builder packaging config headlessly. Producing the actual
// .exe needs Windows (electron-builder --win uses Wine on Linux), so CI proves the config
// shape; `npm run package` on Windows produces the installer (MANUAL-VERIFICATION.md 31-C).
const desktopDir = path.resolve(__dirname, '..')

function readJson(file: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path.join(desktopDir, file), 'utf8'))
}

test('electron-builder targets an unsigned Windows NSIS installer', () => {
  const cfg = readJson('electron-builder.json') as Record<string, any>
  expect(typeof cfg.appId).toBe('string')
  expect(cfg.appId.length).toBeGreaterThan(0)
  expect(cfg.productName).toBeTruthy()

  // Windows NSIS installer target.
  const targets = cfg.win?.target
  const targetNames = Array.isArray(targets) ? targets.map((t: any) => (typeof t === 'string' ? t : t.target)) : [targets]
  expect(targetNames).toContain('nsis')

  // One-click, per-user install (no admin prompt) — the easiest install path.
  expect(cfg.nsis?.oneClick).toBe(true)
  expect(cfg.nsis?.perMachine).toBe(false)
})

test('packaged app bundles the compiled main + the web bundle, in an asar', () => {
  const cfg = readJson('electron-builder.json') as Record<string, any>
  expect(cfg.asar).toBe(true)
  expect(cfg.directories?.output).toBeTruthy()
  // The runtime reads web-dist via __dirname/../web-dist, so both dist and web-dist must ship.
  expect(cfg.files).toEqual(expect.arrayContaining(['dist/**/*', 'web-dist/**/*', 'package.json']))
})

test('the package script builds then runs electron-builder for Windows (not the TODO stub)', () => {
  const pkg = readJson('package.json') as Record<string, any>
  const script = pkg.scripts?.package as string
  expect(script).toContain('electron-builder')
  expect(script).toContain('--win')
  expect(script).toContain('npm run build')
  expect(script).not.toContain('TODO')
})
