import { app, BrowserWindow, session, desktopCapturer, screen } from 'electron'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { startBundleServer } from './server'
import { pickDisplayMediaResponse } from './displayMedia'
import { registerLocalTranscription } from './localTranscriptionIpc'
import { killActiveWhisper } from './localTranscription'

// Phase 31-A — Windows bundle-shell.
// Serve the compiled web/ frontend from a localhost loopback origin and proxy
// /api/* to the live prod site. Loopback (not file://, not app://) because:
//   1. the frontend calls relative /api/* and needs a same-origin server, and
//   2. redirect_uri = window.location.origin, and Google OAuth (Web client)
//      only accepts http://localhost / 127.0.0.1 as a redirect URI.
// See docs/phases/phase-31.md (31-A design) and MANUAL-VERIFICATION.md.

const PORT = 5180 // MUST match the http://localhost:5180 redirect URI registered in Google Cloud Console
const PROD_ORIGIN = 'https://note-taker-ai.com'
const WEB_DIST = path.join(__dirname, '..', 'web-dist') // __dirname = desktop/dist → desktop/web-dist

// Current window, for the main process to push local-transcription events to the renderer.
let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  // Navigation policy: deny popups outright; allow top-level navigation only to the
  // local origin and Google's sign-in domains (the OAuth flow leaves localhost for
  // accounts.google.com and back). Anything else is blocked.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (event, url) => {
    let host = ''
    try { host = new URL(url).hostname } catch { /* malformed → block below */ }
    const allowed = host === 'localhost' || host === '127.0.0.1' || host === 'google.com' || host.endsWith('.google.com')
    if (!allowed) event.preventDefault()
  })

  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
  })
  mainWindow = win
  void win.loadURL(`http://localhost:${PORT}/`)
}

// 31-B — pin the system-audio grant. Without this, getDisplayMedia relies on Electron's
// implicit default (works today on Windows, but undocumented and could regress on an
// Electron upgrade to mic-only — silently, because the renderer's catch swallows it).
// Answer every request deterministically with the primary screen + Windows loopback audio,
// no OS picker. Log every grant/denial so a regression is visible, not silent.
function registerDisplayMediaHandler(): void {
  session.defaultSession.setDisplayMediaRequestHandler(
    (_request, callback) => {
      desktopCapturer
        .getSources({ types: ['screen'] })
        .then((sources) => {
          const primaryId = String(screen.getPrimaryDisplay().id)
          const selection = pickDisplayMediaResponse(sources, primaryId)
          if (selection) {
            const where = selection.matchedPrimary ? 'matched primary' : `no primary match, fell back to first of ${sources.length}`
            console.log(`[desktop] display-media granted: screen ${selection.grant.video.id} (${where}) + loopback audio`)
            callback(selection.grant)
          } else {
            console.warn('[desktop] display-media denied: no screen source — renderer falls back to mic-only')
            callback({})
          }
        })
        .catch((err) => {
          console.error('[desktop] display-media handler failed; denying (mic-only):', err)
          callback({})
        })
    },
    { useSystemPicker: false },
  )
}

function logBuildSha(): void {
  const shaFile = path.join(WEB_DIST, 'build-sha.txt')
  const sha = existsSync(shaFile) ? readFileSync(shaFile, 'utf8').trim() : 'unknown'
  console.log(`[desktop] AI Note Taker — bundled web build ${sha}, proxying /api → ${PROD_ORIGIN}`)
}

void app.whenReady().then(async () => {
  await startBundleServer(PORT, PROD_ORIGIN, WEB_DIST)
  registerDisplayMediaHandler()
  registerLocalTranscription({
    userDataDir: app.getPath('userData'),
    resourcesPath: process.resourcesPath,
    getWindow: () => mainWindow,
  })
  logBuildSha()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// BUG-52: kill any in-flight whisper child on quit — spawned children orphan on Windows and would
// otherwise keep pegging the CPU after the app closes. Runs synchronously so SIGTERM reaches the
// kernel before teardown. Note: kill() terminates the direct child only (fine — whisper-cli is a
// leaf); if anyone ever spawns whisper via a shell wrapper, kill the tree instead.
app.on('before-quit', () => killActiveWhisper())

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
