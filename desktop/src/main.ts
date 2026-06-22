import { app, BrowserWindow } from 'electron'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { startBundleServer } from './server'

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

  void win.loadURL(`http://localhost:${PORT}/`)
}

function logBuildSha(): void {
  const shaFile = path.join(WEB_DIST, 'build-sha.txt')
  const sha = existsSync(shaFile) ? readFileSync(shaFile, 'utf8').trim() : 'unknown'
  console.log(`[desktop] AI Note Taker — bundled web build ${sha}, proxying /api → ${PROD_ORIGIN}`)
}

void app.whenReady().then(async () => {
  await startBundleServer(PORT, PROD_ORIGIN, WEB_DIST)
  logBuildSha()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
