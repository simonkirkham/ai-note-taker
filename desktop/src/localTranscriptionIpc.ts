// 48-A — wire the renderer's local-transcription IPC to the whisper engine, and download
// models in the background on launch. Kept as its own module (not inlined in main.ts) so the
// wiring is readable and the electron surface is thin. One recording at a time → one session.

import { ipcMain, type BrowserWindow } from 'electron'
import path from 'node:path'
import { LocalTranscriptionSession } from './localTranscription'
import { ensureModels, modelsDir, whisperBinPath, MANIFEST_48A } from './modelStore'
import type { LocalStatus } from './preload'

type Deps = {
  userDataDir: string
  resourcesPath: string
  getWindow: () => BrowserWindow | null
}

export function registerLocalTranscription(deps: Deps): void {
  let status: LocalStatus = { modelReady: false, downloading: false, progress: 0 }
  let session: LocalTranscriptionSession | null = null
  let preparing = false // guards against starting the download more than once

  const send = (channel: string, payload: unknown) => deps.getWindow()?.webContents.send(channel, payload)

  // Download models in the background — never blocks the window. Triggered by the renderer only
  // when the user has selected local mode (via 'local:prepare'), so cloud-only users never pull
  // the weights. Local mode stays "Preparing…" (renderer falls back to cloud) until modelReady.
  const prepare = () => {
    if (preparing || status.modelReady) return
    preparing = true
    void ensureModels(deps.userDataDir, MANIFEST_48A, (s) => {
      status = s
      send('local:status', status)
    }).catch((err: Error) => {
      console.error('[desktop] model download failed; local transcription unavailable:', err.message)
      preparing = false
      status = { modelReady: false, downloading: false, progress: 0 }
      send('local:status', status)
    })
  }

  ipcMain.on('local:prepare', prepare)
  ipcMain.handle('local:status', () => status)

  ipcMain.handle('local:start', () => {
    const modelPath = path.join(modelsDir(deps.userDataDir), MANIFEST_48A.models[0].file)
    session = new LocalTranscriptionSession(
      { binPath: whisperBinPath(deps.resourcesPath), modelPath },
      (segs) => send('local:segments', segs),
      (err) => {
        console.error('[desktop] local transcription failed; renderer falls back to cloud:', err.message)
        send('local:error', err.message)
      },
    )
  })

  ipcMain.on('local:pcm', (_e, pcm: ArrayBuffer) => {
    session?.pushPcm(Buffer.from(pcm))
  })

  ipcMain.handle('local:finish', async () => {
    const s = session
    session = null
    await s?.finish()
  })
}
