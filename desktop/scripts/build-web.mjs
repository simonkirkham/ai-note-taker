// Build the web/ frontend and stage it as the desktop bundle (web-dist/).
// Bakes VITE_GOOGLE_CLIENT_ID into the bundle so `npm run app`/`package` work with
// no env var; the installed app has no env at run time, so the value must be baked here.
import { execSync } from 'node:child_process'
import { cpSync, rmSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { extractRumSnippet, injectRumSnippet } from './rumSnippet.mjs'

const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const webDir = path.resolve(desktopDir, '..', 'web')
const webDist = path.join(webDir, 'dist')
const target = path.join(desktopDir, 'web-dist')

// The Google OAuth client id is public (it ships in every frontend bundle already), so we
// default it — a packaged build has no env, and `npm run package`/`app` must "just work".
// Override with VITE_GOOGLE_CLIENT_ID if ever needed.
const DEFAULT_GOOGLE_CLIENT_ID = '175601380067-sck0gefe6d7uuaks304h1fi98v6cl5ff.apps.googleusercontent.com'
const clientId = process.env.VITE_GOOGLE_CLIENT_ID || DEFAULT_GOOGLE_CLIENT_ID
if (!process.env.VITE_GOOGLE_CLIENT_ID) {
  console.log(`[build:web] using default desktop Google client id (${clientId.slice(0, 12)}…)`)
}

console.log('[build:web] building web/ …')
execSync('npm run build', { cwd: webDir, stdio: 'inherit', env: { ...process.env, VITE_GOOGLE_CLIENT_ID: clientId } })

console.log(`[build:web] staging ${webDist} → ${target}`)
rmSync(target, { recursive: true, force: true })
mkdirSync(target, { recursive: true })
cpSync(webDist, target, { recursive: true })

// TI-98 — copy the live site's monitoring snippet so desktop faults are reported too.
// The published installer (REQUIRE_RUM_SNIPPET=1) refuses to ship without it; a local build
// just says it has none.
const rumSource = process.env.RUM_SNIPPET_SOURCE_URL || 'https://note-taker-ai.com/'
const requireRum = process.env.REQUIRE_RUM_SNIPPET === '1'
let snippet = null
try {
  const res = await fetch(rumSource)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  snippet = extractRumSnippet(await res.text())
  if (!snippet) throw new Error('no populated rum-snippet in the page')
} catch (err) {
  const msg = `[build:web] no monitoring snippet from ${rumSource}: ${err.message}`
  if (requireRum) {
    console.error(msg)
    process.exit(1)
  }
  console.warn(`${msg} — this build will report no faults`)
}
if (snippet) {
  const indexFile = path.join(target, 'index.html')
  writeFileSync(indexFile, injectRumSnippet(readFileSync(indexFile, 'utf8'), snippet))
  console.log(`[build:web] monitoring snippet copied from ${rumSource}`)
}

const sha = execSync('git rev-parse HEAD', { cwd: desktopDir }).toString().trim()
writeFileSync(path.join(target, 'build-sha.txt'), sha)
console.log(`[build:web] done — bundled web build ${sha.slice(0, 7)}`)
