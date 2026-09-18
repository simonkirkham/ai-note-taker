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

// CHANGE-43 — the build stamp is a link to the pipeline run. In the shell a new window is denied,
// so the only way it can do anything is the main process handing the URL to the system browser.
// The predicate deciding WHICH urls qualify is unit-tested; this covers the wiring, which is the
// half that fails silently (a denied window that opens nothing looks like a link nobody clicked).
async function captureExternalOpens(application: ElectronApplication): Promise<void> {
  // No return value: Playwright would serialise a COPY taken before any open happens, and an
  // assertion against that copy could never fail. Reads go through readExternalOpens instead.
  await application.evaluate(({ shell }) => {
    const opened: string[] = []
    ;(globalThis as unknown as { __opened?: string[] }).__opened = opened
    shell.openExternal = (url: string) => {
      opened.push(url)
      return Promise.resolve()
    }
  })
}

const readExternalOpens = (application: ElectronApplication) =>
  application.evaluate(() => (globalThis as unknown as { __opened?: string[] }).__opened ?? [])

const RUN_URL = 'https://github.com/simonkirkham/ai-note-taker/actions/runs/35127113946'

test("a link to this repo's pipeline run reaches the system browser", async () => {
  const page = await app.firstWindow()
  await page.getByRole('button', { name: /sign in with google/i }).waitFor({ timeout: APP_BOOT_TIMEOUT_MS })
  await captureExternalOpens(app)

  await page.evaluate((url) => window.open(url, '_blank'), RUN_URL)
  await expect.poll(() => readExternalOpens(app), { timeout: APP_BOOT_TIMEOUT_MS }).toEqual([RUN_URL])

  // ...and no second window was opened inside the app.
  expect(app.windows()).toHaveLength(1)
})

test('a link anywhere else opens nothing at all', async () => {
  const page = await app.firstWindow()
  await page.getByRole('button', { name: /sign in with google/i }).waitFor({ timeout: APP_BOOT_TIMEOUT_MS })
  await captureExternalOpens(app)

  await page.evaluate(() => window.open('https://example.test/anything', '_blank'))
  // The allowed URL is the flush: once it has arrived, the disallowed one has had its chance. A
  // fixed sleep here could only ever produce a false pass, which is the one thing a control must
  // not do.
  await page.evaluate((url) => window.open(url, '_blank'), RUN_URL)
  await expect.poll(() => readExternalOpens(app), { timeout: APP_BOOT_TIMEOUT_MS }).toEqual([RUN_URL])
  expect(app.windows()).toHaveLength(1)
})
