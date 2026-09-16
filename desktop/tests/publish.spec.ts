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

test('publish workflow uploads build-sha.txt so the update script can version-check', () => {
  const wf = read('.github/workflows/publish-desktop.yml')
  // 31-E: the tiny SHA marker rides alongside the .exe so `npm run update` can compare
  // versions without downloading the 82 MB installer.
  expect(wf).toContain('build-sha.txt')
})

test('npm run update pulls the published installer and installs it', () => {
  const pkg = JSON.parse(read('desktop/package.json')) as { scripts?: Record<string, string> }
  expect(pkg.scripts?.update).toBeTruthy()
  expect(pkg.scripts!.update).toContain('update.ps1')

  const script = read('desktop/scripts/update.ps1')
  expect(script).toContain('releases/tags/desktop-latest')
  expect(script).toContain('/S') // silent NSIS install
})

test('npm run update skips the download when already on the latest published build', () => {
  const script = read('desktop/scripts/update.ps1')
  // 31-E: fetch the tiny SHA marker, compare to the recorded installed SHA, and exit early
  // when they match — no 82 MB re-download.
  expect(script).toContain('build-sha.txt')
  expect(script).toMatch(/up to date|already.*latest|already.*current/i)
})

test('update.ps1 is pure ASCII so Windows PowerShell 5.1 parses it correctly', () => {
  // Windows PowerShell 5.1 reads a no-BOM .ps1 as the ANSI codepage (Windows-1252), not UTF-8.
  // A UTF-8 em-dash's third byte (0x94) then decodes to a `"` that closes a string early and
  // breaks parsing (the "term 'silent' is not recognized" failure). Keep the script ASCII-only.
  const script = read('desktop/scripts/update.ps1')
  const nonAscii = [...script].filter((ch) => ch.charCodeAt(0) > 127)
  expect(nonAscii).toEqual([])
})

// 53-A — the update notice reads an update history published alongside the installer, and
// offers a command that fetches update.ps1 from the same release.
test('publish workflow appends to and uploads the update history', () => {
  const wf = read('.github/workflows/publish-desktop.yml')
  expect(wf).toContain('releases.json')
  // Carries forward what the previous release published rather than starting over each time.
  expect(wf).toMatch(/gh release download desktop-latest[^\n]*releases\.json/)
  expect(wf).toContain('node desktop/scripts/append-history.mjs')
})

test('publish workflow bakes the build time into the app and publishes update.ps1', () => {
  const wf = read('.github/workflows/publish-desktop.yml')
  expect(wf).toContain('VITE_BUILD_TIME')
  expect(wf).toContain('desktop/scripts/update.ps1')
})

// 53-A review: the in-app command runs on machines with no GitHub CLI. The script must reach
// the public release anonymously, never through `gh`.
test('update.ps1 does not need the GitHub CLI', () => {
  const script = read('desktop/scripts/update.ps1')
  expect(script).not.toMatch(/^\s*gh\s/m)
  expect(script).toContain('Invoke-WebRequest')
})

test('the command the app shows is the one the desktop shell copies', () => {
  const web = read('web/src/components/UpdateNotice.tsx')
  const shell = read('desktop/src/updateCommand.ts')
  const quoted = (text: string) => text.match(/UPDATE_COMMAND\s*=\s*\n?\s*('.*');/)?.[1]
  expect(quoted(shell)).toBeTruthy()
  expect(quoted(web)).toBe(quoted(shell))
})

test('publish workflow never deletes the release without a history to replace it', () => {
  const wf = read('.github/workflows/publish-desktop.yml')
  expect(wf.indexOf('test -s releases.json')).toBeGreaterThan(-1)
  expect(wf.indexOf('test -s releases.json')).toBeLessThan(wf.indexOf('gh release delete'))
  expect(wf).toMatch(/concurrency:\s*\n\s*group:\s*publish-desktop/)
})
