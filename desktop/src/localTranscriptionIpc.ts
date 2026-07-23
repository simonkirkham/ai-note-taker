// 48-A — wire the renderer's local-transcription IPC to the whisper engine, and download
// models in the background on launch. Kept as its own module (not inlined in main.ts) so the
// wiring is readable and the electron surface is thin. One recording at a time → one session.

import { ipcMain, type BrowserWindow } from 'electron'
import { existsSync } from 'node:fs'
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
    const binPath = whisperBinPath(deps.resourcesPath)
    const modelPath = path.join(modelsDir(deps.userDataDir), MANIFEST_48A.models[0].file)
    // Validate the engine up front so a missing binary/model rejects here — the renderer then
    // takes its clean pre-recording cloud fallback instead of failing mid-recording.
    if (!existsSync(binPath)) throw new Error(`whisper binary not found at ${binPath}`)
    if (!existsSync(modelPath)) throw new Error(`whisper model not found at ${modelPath}`)
    // Discard any prior session (rapid stop→start) so its late segments can't leak in.
    session = null
    session = new LocalTranscriptionSession(
      { binPath, modelPath },
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
