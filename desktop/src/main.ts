import { app, BrowserWindow, clipboard, ipcMain, Menu, net, session, shell, desktopCapturer, screen } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { startBundleServer } from './server'
import { pickDisplayMediaResponse } from './displayMedia'
import { buildSpellCheckMenu } from './spellCheckMenu'
import { decidePermissionCheck, decidePermissionRequest } from './permissionPolicy'
import { registerLocalTranscription, killWhisperServer } from './localTranscriptionIpc'
import { killActiveWhisper } from './localTranscription'
import { fetchHistory } from './updateCheck'
import { isBundleOrigin } from './ipcOrigin'
import { shouldOpenExternally } from './externalLink'
import { UPDATE_COMMAND } from './updateCommand'
import { autoUpdater } from 'electron-updater'
import { createAutoUpdate } from './autoUpdate'

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
  // CHANGE-43: still no in-app popups; this repo's own pages (the build stamp's pipeline-run
  // link) hand off to the system browser instead, and everything else is dropped.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (shouldOpenExternally(url)) {
      // A dropped rejection here would be a link that silently does nothing (no default browser,
      // no handler for https) — the one failure mode nobody would report.
      shell.openExternal(url).catch((err) => console.warn(`[desktop] could not open ${url}:`, err))
    }
    return { action: 'deny' }
  })
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
// Note: this policy governs what the RENDERER may ask Chromium for. It is not the whole story for
// leaving the app — the window-open handler in createWindow hands this repo's own GitHub pages to
// the system browser from the main process (CHANGE-43).
function registerPermissionHandlers(): void {
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback, details) => {
    const decision = decidePermissionRequest(
      {
        permission,
        requestingUrl: details.requestingUrl,
        isMainFrame: details.isMainFrame,
        mediaTypes: 'mediaTypes' in details ? details.mediaTypes : undefined,
      },
      BUNDLE_ORIGINS,
    )
    logDecision('request', permission, decision.allow, decision.reason)
    callback(decision.allow)
  })

  session.defaultSession.setPermissionCheckHandler((_webContents, permission, requestingOrigin, details) => {
    const decision = decidePermissionCheck(
      {
        permission,
        requestingOrigin,
        securityOrigin: details.securityOrigin,
        isMainFrame: details.isMainFrame,
        mediaType: details.mediaType,
      },
      BUNDLE_ORIGINS,
    )
    logDecision('check', permission, decision.allow, decision.reason)
    return decision.allow
  })
}

// Checks are polled, not one-shot: Notification.permission is a synchronous getter that
// round-trips to the browser process on every read, and MeetingsSection reads it in its render
// body — so logging every check emits a line on every re-render and buries the request-decision
// lines MANUAL-VERIFICATION #2 and #5 tell the operator to look for. Dedupe on the full decision
// so a CHANGED outcome still prints; requests are one-shot and always logged.
const loggedChecks = new Set<string>()

// Denials are warnings: every one is either an attempt from an origin that should not have the
// mic, or a feature this app does not know it uses — both worth seeing in the console.
function logDecision(kind: 'request' | 'check', permission: string, allow: boolean, reason: string): void {
  if (kind === 'check') {
    const key = `${permission}|${allow}|${reason}`
    if (loggedChecks.has(key)) return
    loggedChecks.add(key)
  }
  const line = `[desktop] permission ${kind} ${permission}: ${allow ? 'granted' : 'denied'} — ${reason}`
  if (allow) console.log(line)
  else console.warn(line)
}

// CHANGE-46 — the public web address of this app. In the desktop window
// window.location.origin is http://localhost:5180, which resolves on this machine only and
// while the app is running, so a note link copied there would be useless to anyone. The shell
// hands the renderer the public origin instead; PROD_ORIGIN above stays the single definition
// (a sandboxed preload cannot import it, so it comes over IPC like everything else).
function registerPublicOrigin(): void {
  ipcMain.handle('app:publicOrigin', (event) => (fromBundle(event) ? PROD_ORIGIN : null))
}

// Every IPC channel answers the app's own pages only — the window also visits Google's
// sign-in, which gets the same preload.
function fromBundle(event: Electron.IpcMainInvokeEvent): boolean {
  return isBundleOrigin(event.senderFrame?.url, BUNDLE_ORIGINS)
}

// 53-A — the update notice's two main-process calls. net.fetch uses Chromium's network stack,
// so it honours the system proxy the same way the window does.
function registerUpdateNotice(): void {
  ipcMain.handle('updates:history', (event) => (fromBundle(event) ? fetchHistory((url, init) => net.fetch(url, init)) : null))
  ipcMain.handle('updates:copy', (event) => {
    if (!fromBundle(event)) return false
    clipboard.writeText(UPDATE_COMMAND)
    return clipboard.readText() === UPDATE_COMMAND
  })
}

// 54-A — download each new version in the background and install it when the app closes. The
// renderer reads the state to show "Restart now", or the 53-A command when this fails.
let autoUpdate: ReturnType<typeof createAutoUpdate> | null = null

function registerAutoUpdate(): void {
  const attemptFile = path.join(app.getPath('userData'), 'update-attempt.txt')
  // electron-updater logs every hourly check to the console by default; keep only what matters.
  // Errors reach our own warning through the 'error' event. The installer's launch failure is
  // reported only as info, so that one line is kept.
  autoUpdater.logger = {
    info: (m: unknown) => {
      if (String(m).includes('Cannot run installer')) console.warn('[desktop] updater:', m)
    },
    warn: (m: unknown) => console.warn('[desktop] updater:', m),
    error: () => {},
  }
  autoUpdate = createAutoUpdate({
    updater: autoUpdater,
    isPackaged: app.isPackaged,
    currentVersion: app.getVersion(),
    attempts: {
      read: () => {
        try {
          return existsSync(attemptFile) ? readFileSync(attemptFile, 'utf8').trim() || null : null
        } catch (err) {
          console.warn('[desktop] could not read the update attempt:', err)
          return null
        }
      },
      write: (version) => {
        try {
          writeFileSync(attemptFile, version ?? '')
        } catch (err) {
          console.warn('[desktop] could not record the update attempt:', err)
        }
      },
    },
    onState: (state) => {
      // Only the app's own page — the window also shows Google's sign-in pages.
      if (mainWindow && isBundleOrigin(mainWindow.webContents.getURL(), BUNDLE_ORIGINS)) {
        mainWindow.webContents.send('updates:state', state)
      }
    },
    warn: (message) => console.warn(message),
    setInterval: (fn, ms) => {
      setInterval(fn, ms)
    },
  })
  const auto = autoUpdate
  ipcMain.handle('updates:getState', (event) => (fromBundle(event) ? auto.getState() : null))
  ipcMain.handle('updates:restart', (event) => {
    if (fromBundle(event)) auto.restart()
  })
  auto.start()
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
  registerPublicOrigin()
  registerUpdateNotice()
  registerAutoUpdate()
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
  autoUpdate?.noteQuit() // 54-A: a ready update installs now — remember which one
  killActiveWhisper()
  killWhisperServer() // BUG-53: tear down the resident whisper-server child on quit
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
