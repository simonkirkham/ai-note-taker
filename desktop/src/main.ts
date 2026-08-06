import { app, BrowserWindow, Menu, session, desktopCapturer, screen } from 'electron'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { startBundleServer } from './server'
import { pickDisplayMediaResponse } from './displayMedia'
import { buildSpellCheckMenu } from './spellCheckMenu'
import { decidePermissionCheck, decidePermissionRequest } from './permissionPolicy'
import { registerLocalTranscription, killWhisperServer } from './localTranscriptionIpc'
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

// The only origins allowed to open the mic. createWindow loads `localhost`; 127.0.0.1 is the
// same bundle server and will-navigate already treats the two as equivalent.
const BUNDLE_ORIGINS = [`http://localhost:${PORT}`, `http://127.0.0.1:${PORT}`]

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

  registerSpellCheckMenu(win)

  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
  })
  mainWindow = win
  void win.loadURL(`http://localhost:${PORT}/`)
}

// CHANGE-37 — right-click spelling corrections. Electron's spellchecker is on by default
// (the squiggles already appeared), but Electron ships NO default context menu, so there
// was no way to ACT on one. Build the menu from Chromium's own suggestions; the decision
// of what to show is pure and lives in spellCheckMenu.ts.
//
// Only pops for a misspelled word in an editable field — a right-click anywhere else keeps
// today's behaviour (no menu) rather than showing an empty one.
function registerSpellCheckMenu(win: BrowserWindow): void {
  win.webContents.on('context-menu', (_event, params) => {
    const items = buildSpellCheckMenu({
      isEditable: params.isEditable,
      misspelledWord: params.misspelledWord,
      // Electron documents dictionarySuggestions as only present when there IS a misspelled
      // word, while typing it non-optional — defensive against that divergence.
      dictionarySuggestions: params.dictionarySuggestions ?? [],
    })
    if (!items) return

    const menu = Menu.buildFromTemplate(
      items.map((item) =>
        'separator' in item
          ? { type: 'separator' as const }
          : {
              label: item.label,
              click: () => {
                // An already-open menu can outlive its window; touching webContents on a
                // destroyed BrowserWindow throws an uncaught main-process exception.
                if (win.isDestroyed()) return
                const action = item.action
                switch (action.kind) {
                  case 'replace':
                    win.webContents.replaceMisspelling(action.word)
                    return
                  case 'addToDictionary': {
                    // Returns false when the write fails. Log it — same discipline as the
                    // display-media handler below, so a regression is visible not silent.
                    const added = win.webContents.session.addWordToSpellCheckerDictionary(action.word)
                    if (!added) console.warn(`[desktop] spellcheck: failed to add "${action.word}" to the dictionary`)
                    return
                  }
                  default: {
                    // A new SpellCheckAction kind must be handled explicitly, not fall
                    // through to the dictionary write.
                    const never: never = action
                    console.warn('[desktop] spellcheck: unhandled action', never)
                  }
                }
              },
            },
      ),
    )
    menu.popup({ window: win })
  })
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

// CHANGE-32 — pin the microphone grant. Same reasoning as the display-media pin above: with no
// handler, getUserMedia({ audio: true }) rides Electron's implicit-grant default, and an
// upgrade that flipped it to deny would silently kill recording (the mic is the base
// transcription stream, no fallback). Electron needs BOTH handlers — the request handler
// answers a prompt, the check handler answers "do I already have it?" (navigator.permissions,
// enumerateDevices labels, Chromium's pre-flight). The decision itself is pure and lives in
// permissionPolicy.ts; this only unwraps Electron's two different shapes and logs.
// Note: this does not touch the Windows OS-level microphone privacy setting.
function registerPermissionHandlers(): void {
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback, details) => {
    const decision = decidePermissionRequest(
      {
        permission,
        requestingUrl: details.requestingUrl,
        mediaTypes: 'mediaTypes' in details ? details.mediaTypes : undefined,
      },
      BUNDLE_ORIGINS,
    )
    logDecision('request', permission, decision.allow, decision.reason)
    callback(decision.allow)
  })

  session.defaultSession.setPermissionCheckHandler((_webContents, permission, requestingOrigin, details) => {
    const decision = decidePermissionCheck({ permission, requestingOrigin, mediaType: details.mediaType }, BUNDLE_ORIGINS)
    logDecision('check', permission, decision.allow, decision.reason)
    return decision.allow
  })
}

// Denials are warnings: every one is either an attempt from an origin that should not have the
// mic, or a feature this app does not know it uses — both worth seeing in the console.
function logDecision(kind: 'request' | 'check', permission: string, allow: boolean, reason: string): void {
  const line = `[desktop] permission ${kind} ${permission}: ${allow ? 'granted' : 'denied'} — ${reason}`
  if (allow) console.log(line)
  else console.warn(line)
}

function logBuildSha(): void {
  const shaFile = path.join(WEB_DIST, 'build-sha.txt')
  const sha = existsSync(shaFile) ? readFileSync(shaFile, 'utf8').trim() : 'unknown'
  console.log(`[desktop] AI Note Taker — bundled web build ${sha}, proxying /api → ${PROD_ORIGIN}`)
}

void app.whenReady().then(async () => {
  await startBundleServer(PORT, PROD_ORIGIN, WEB_DIST)
  registerPermissionHandlers()
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
app.on('before-quit', () => {
  killActiveWhisper()
  killWhisperServer() // BUG-53: tear down the resident whisper-server child on quit
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
