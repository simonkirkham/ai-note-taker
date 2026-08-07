import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test'
import path from 'node:path'

// Slice 31-A — automated portion (the cheap, honest assertions).
// Proves: the Electron app launches and renders the BUNDLED frontend from local
// assets (not a CloudFront fetch). Real Google sign-in + restart-persistence are
// NOT automatable here (need real OIDC + Windows OS) — see MANUAL-VERIFICATION.md.
//
// RED until Pip (a) builds the web bundle into desktop/web-dist and (b) adds
// src/main.ts that creates a BrowserWindow loading that bundle from disk.

const appRoot = path.resolve(__dirname, '..')

// BUG-64 — a cold Electron launch on a CI runner (fresh process + xvfb + the SPA's first paint)
// routinely needs more than Playwright's 5s default EXPECT timeout. The second test never hit this
// because locator.waitFor() defaults to 30s, so only the assertion-style wait was tight — which is
// why one test failed and the other passed on the SAME launch. Give both the same headroom.
const APP_BOOT_TIMEOUT_MS = 30_000

let app: ElectronApplication

test.beforeEach(async () => {
  app = await electron.launch({ args: [appRoot] })
})

test.afterEach(async () => {
  await app?.close()
})

// Given the bundled desktop app, When launched,
// Then the frontend renders from local assets (no CloudFront fetch).
test('launches and renders the bundled frontend from local assets', async () => {
  const window = await app.firstWindow()
  await expect(window.getByRole('button', { name: /sign in with google/i })).toBeVisible({
    timeout: APP_BOOT_TIMEOUT_MS,
  })

  // Served from the local loopback origin (not the remote prod site).
  const url = window.url()
  expect(url).not.toContain('note-taker-ai.com')
  expect(url).toMatch(/^http:\/\/(localhost|127\.0\.0\.1):\d+/)
})

// Given the renderer, Then it is sandboxed: contextIsolation on, no Node in renderer.
test('renderer has no Node integration (contextIsolation enforced)', async () => {
  const window = await app.firstWindow()
  await window.getByRole('button', { name: /sign in with google/i }).waitFor({ timeout: APP_BOOT_TIMEOUT_MS })
  const hasNodeRequire = await window.evaluate(() => typeof (globalThis as { require?: unknown }).require !== 'undefined')
  expect(hasNodeRequire).toBe(false)
})
