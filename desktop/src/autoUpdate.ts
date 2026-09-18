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
  checkForUpdates(): Promise<unknown>
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void
  on(event: string, listener: (...args: any[]) => void): unknown
}

export const CHECK_EVERY_MS = 60 * 60 * 1000

export function createAutoUpdate({
  updater,
  isPackaged,
  onState,
  warn,
  setInterval,
}: {
  updater: Updater
  // electron-updater refuses to run unpackaged; a dev build reports 'disabled' instead.
  isPackaged: boolean
  onState: (state: AutoUpdateState) => void
  warn: (message: string) => void
  setInterval: (fn: () => void, ms: number) => void
}) {
  let state: AutoUpdateState = 'disabled'

  const set = (next: AutoUpdateState) => {
    // A downloaded update is installed on quit whatever a later check says, so 'ready' is final.
    if (state === 'ready' || state === next) return
    state = next
    onState(next)
  }

  const fail = (err: unknown) => {
    warn(`[desktop] auto-update failed: ${err instanceof Error ? err.message : String(err)}`)
    set('failed')
  }

  const check = () => {
    if (state === 'downloading' || state === 'ready') return
    // electron-updater both emits 'error' and rejects for the same failure; log it once.
    updater.checkForUpdates().catch((err) => {
      if (state !== 'failed') fail(err)
    })
  }

  return {
    start() {
      if (!isPackaged) return
      updater.autoDownload = true
      updater.autoInstallOnAppQuit = true
      updater.on('checking-for-update', () => set('checking'))
      updater.on('update-available', () => set('downloading'))
      updater.on('update-not-available', () => set('none'))
      updater.on('update-downloaded', () => set('ready'))
      updater.on('error', fail)
      check()
      setInterval(check, CHECK_EVERY_MS)
    },
    getState: () => state,
    restart() {
      // Silent install, then reopen the app on the new version.
      if (state === 'ready') updater.quitAndInstall(true, true)
    },
  }
}
