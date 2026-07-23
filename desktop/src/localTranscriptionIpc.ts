// 48-A — wire the renderer's local-transcription IPC to the whisper engine, and download
// models in the background on launch. Kept as its own module (not inlined in main.ts) so the
// wiring is readable and the electron surface is thin. One recording at a time → one session.

import { ipcMain, type BrowserWindow } from 'electron'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { LocalTranscriptionSession } from './localTranscription'
import { ensureModels, modelsDir, whisperBinPath, finalModelFile, MANIFEST } from './modelStore'
import { isLive } from './models'
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
    void ensureModels(deps.userDataDir, MANIFEST, (s) => {
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
    const dir = modelsDir(deps.userDataDir)
    const liveSpec = MANIFEST.models.find(isLive)
    if (!liveSpec) throw new Error('no live model configured in the manifest')
    const modelPath = path.join(dir, liveSpec.file)
    // 48-B: the medium.en final model is best-effort — pass its path only if it has downloaded,
    // so runFinalPass runs when present and is skipped (live text kept) when it isn't.
    const finalPath = path.join(dir, finalModelFile())
    const finalModelPath = finalModelFile() && existsSync(finalPath) ? finalPath : undefined
    // Validate the live engine up front so a missing binary/model rejects here — the renderer then
    // takes its clean pre-recording cloud fallback instead of failing mid-recording.
    if (!existsSync(binPath)) throw new Error(`whisper binary not found at ${binPath}`)
    if (!existsSync(modelPath)) throw new Error(`whisper model not found at ${modelPath}`)
    // Discard any prior session (rapid stop→start) so its late segments can't leak in.
    session = null
    session = new LocalTranscriptionSession(
      { binPath, modelPath, finalModelPath },
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

  // Flush the live tail, then run the higher-quality final pass (48-B). Returns the final
  // transcript text (or null → renderer keeps the live text). Runs before the renderer commits.
  ipcMain.handle('local:finish', async (): Promise<string | null> => {
    const s = session
    session = null
    if (!s) return null
    await s.finish()
    try {
      return await s.runFinalPass()
    } catch (err) {
      console.error('[desktop] final pass failed; keeping live transcript:', (err as Error).message)
      return null
    }
  })
}
