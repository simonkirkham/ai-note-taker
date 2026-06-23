import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import path from 'node:path'

// 31-D — assert the publish-installer wiring headlessly: a CI workflow that builds the
// installer on a Windows runner after a successful prod deploy and uploads it to GitHub
// Releases, plus the `npm run update` script that pulls + installs it. The workflow only
// runs in CI and the script only runs on Windows, so this just guards the wiring.
const desktopDir = path.resolve(__dirname, '..')
const repoRoot = path.resolve(desktopDir, '..')

function read(rel: string): string {
  return readFileSync(path.join(repoRoot, rel), 'utf8')
}

test('publish workflow triggers after a successful Deploy and builds on Windows', () => {
  const wf = read('.github/workflows/publish-desktop.yml')
  // Runs only after the prod Deploy workflow finished — so the artifact == a deployed version.
  expect(wf).toContain('workflow_run')
  expect(wf).toMatch(/workflows:\s*\[?\s*["']?Deploy/)
  expect(wf).toContain('windows-latest')
  // Needs write access to publish a Release.
  expect(wf).toMatch(/contents:\s*write/)
})

test('publish workflow packages the installer and uploads it to a Release', () => {
  const wf = read('.github/workflows/publish-desktop.yml')
  expect(wf).toContain('run package')
  expect(wf).toContain('gh release')
  // Only build when the frontend/desktop actually changed (no installer for backend/docs-only).
  expect(wf).toMatch(/web\/\|desktop\/|desktop\/\|web\//)
})

test('npm run update pulls the published installer and installs it', () => {
  const pkg = JSON.parse(read('desktop/package.json')) as { scripts?: Record<string, string> }
  expect(pkg.scripts?.update).toBeTruthy()
  expect(pkg.scripts!.update).toContain('update.ps1')

  const script = read('desktop/scripts/update.ps1')
  expect(script).toContain('gh release download')
  expect(script).toContain('/S') // silent NSIS install
})
