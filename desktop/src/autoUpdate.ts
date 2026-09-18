// 54-A — the app updates itself. A newer published version downloads in the background and
// installs when the app closes; the renderer is told one state so its notice can offer
// "Restart now", or fall back to the 53-A copy-command notice when updating itself fails.
//
// The updater is injected so the state machine is testable without Electron. main.ts passes
// electron-updater's `autoUpdater`, which reads its feed from the app-update.yml electron-builder
// bakes in from the `publish` entry in electron-builder.json.

export type AutoUpdateState = 'disabled' | 'checking' | 'downloading' | 'ready' | 'none' | 'failed'

export interface Updater {
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  // With autoDownload on, electron-updater's result carries the download's own promise.
  checkForUpdates(): Promise<{ downloadPromise?: Promise<unknown> | null } | null>
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void
  on(event: string, listener: (...args: any[]) => void): unknown
}

export const CHECK_EVERY_MS = 60 * 60 * 1000

export function createAutoUpdate({
  updater,
  isPackaged,
  currentVersion,
  attempts,
  onState,
  warn,
  setInterval,
}: {
  updater: Updater
  // electron-updater refuses to run unpackaged; a dev build reports 'disabled' instead.
  isPackaged: boolean
  currentVersion: string
  // The version last handed to the installer, kept across launches. Without it, an install that
  // never takes (antivirus quarantines the unsigned installer, say) re-reads "ready" from the
  // cached download on every launch, and the fallback command never appears.
  attempts: { read(): string | null; write(version: string | null): void }
  onState: (state: AutoUpdateState) => void
  warn: (message: string) => void
  setInterval: (fn: () => void, ms: number) => void
}) {
  let state: AutoUpdateState = 'disabled'
  let readyVersion: string | null = null
  // Once the installer has been launched, an error can only be the install failing.
  let installing = false
  // An install that did not take would otherwise re-download (~89 MB) and fail again every hour.
  // The fallback command is showing; a relaunch tries again.
  let installDidNotTake = false

  const set = (next: AutoUpdateState) => {
    // A downloaded update is installed on quit whatever a later check says, so 'ready' holds —
    // unless installing it is what failed.
    if ((state === 'ready' && !(installing && next === 'failed')) || state === next) return
    state = next
    onState(next)
  }

  const recordAttempt = () => {
    if (state === 'ready' && readyVersion) attempts.write(readyVersion)
  }

  const downloaded = (info: { version?: string } | undefined) => {
    const version = info?.version ?? null
    if (version && version === attempts.read() && version !== currentVersion) {
      warn(`[desktop] auto-update failed: ${version} was downloaded and handed to the installer, but this copy is still ${currentVersion}`)
      installDidNotTake = true
      set('failed')
      return
    }
    readyVersion = version
    set('ready')
  }

  const fail = (err: unknown) => {
    warn(`[desktop] auto-update failed: ${err instanceof Error ? err.message : String(err)}`)
    set('failed')
  }

  const check = () => {
    if (state === 'downloading' || state === 'ready' || installDidNotTake) return
    // electron-updater both emits 'error' and rejects for the same failure; log it once. The
    // background download rejects separately — already reported through 'error', so it is only
    // caught here to keep it from surfacing as an unhandled rejection.
    updater.checkForUpdates().then(
      (result) => {
        result?.downloadPromise?.catch(() => {})
      },
      (err) => {
        if (state !== 'failed') fail(err)
      },
    )
  }

  return {
    start() {
      if (!isPackaged) return
      updater.autoDownload = true
      updater.autoInstallOnAppQuit = true
      updater.on('checking-for-update', () => set('checking'))
      updater.on('update-available', () => set('downloading'))
      updater.on('update-not-available', () => set('none'))
      updater.on('update-downloaded', downloaded)
      updater.on('error', fail)
      check()
      setInterval(check, CHECK_EVERY_MS)
    },
    getState: () => state,
    // The page hides Restart now while a recording is running or saving; the installer this
    // launches closes the app regardless, so any other caller must check the same first.
    restart() {
      if (state !== 'ready') return
      recordAttempt()
      installing = true
      // Silent install, then reopen the app on the new version.
      updater.quitAndInstall(true, true)
    },
    // Closing the app installs a ready update (autoInstallOnAppQuit).
    noteQuit() {
      recordAttempt()
      if (state === 'ready') installing = true
    },
  }
}
