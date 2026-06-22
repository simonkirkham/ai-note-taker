// Build the web/ frontend and stage it as the desktop bundle (web-dist/).
// Bakes VITE_GOOGLE_CLIENT_ID (needed for real Google sign-in) from the
// environment; the automated shell test renders fine without it.
import { execSync } from 'node:child_process'
import { cpSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const webDir = path.resolve(desktopDir, '..', 'web')
const webDist = path.join(webDir, 'dist')
const target = path.join(desktopDir, 'web-dist')

if (!process.env.VITE_GOOGLE_CLIENT_ID) {
  console.warn('[build:web] VITE_GOOGLE_CLIENT_ID not set — shell will render but Google sign-in will not work.')
}

console.log('[build:web] building web/ …')
execSync('npm run build', { cwd: webDir, stdio: 'inherit', env: process.env })

console.log(`[build:web] staging ${webDist} → ${target}`)
rmSync(target, { recursive: true, force: true })
mkdirSync(target, { recursive: true })
cpSync(webDist, target, { recursive: true })

const sha = execSync('git rev-parse HEAD', { cwd: desktopDir }).toString().trim()
writeFileSync(path.join(target, 'build-sha.txt'), sha)
console.log(`[build:web] done — bundled web build ${sha.slice(0, 7)}`)
