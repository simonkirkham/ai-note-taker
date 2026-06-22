import { defineConfig } from '@playwright/test'

// Desktop E2E drives the real Electron app via Playwright's _electron API (Node-only).
// CI runs headless Linux → wrap `npm run test:e2e` in xvfb-run (see README).
export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.e2e.ts',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
})
