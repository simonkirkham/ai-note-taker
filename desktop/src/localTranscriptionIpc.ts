// 48-A — wire the renderer's local-transcription IPC to the whisper engine, and download
// models in the background on launch. Kept as its own module (not inlined in main.ts) so the
// wiring is readable and the electron surface is thin. One recording at a time → one session.

import { ipcMain, type BrowserWindow } from 'electron'
import { existsSync } from 'node:fs'
import { cpus } from 'node:os'
import path from 'node:path'
import { transcribeWindow, diarizeStreams, killActiveWhisper } from './localTranscription'
import { pickThreads } from './localEngine'
import { StreamingSession } from './streamingSession'
import { WhisperServer } from './whisperServer'
import { ensureModels, modelsDir, whisperBinPath, finalModelFile, vadModelFile, MANIFEST } from './modelStore'
import { isLive } from './models'
import type { LocalStatus } from './preload'

// BUG-53: the resident whisper-server (loaded with the live model) is shared across recordings and
// only torn down on app-quit. main.ts calls this from before-quit alongside killActiveWhisper.
let sharedServer: WhisperServer | null = null
export function killWhisperServer(): void {
  sharedServer?.kill()
  sharedServer = null
}

type Deps = {
  userDataDir: string
  resourcesPath: string
  getWindow: () => BrowserWindow | null
}

export function registerLocalTranscription(deps: Deps): void {
  let status: LocalStatus = { modelReady: false, downloading: false, progress: 0 }
  let streaming: StreamingSession | null = null
  let finalOpts: { binPath: string; finalModelPath?: string } | null = null // for the stop-time pass
  let preparing = false // guards against starting the download more than once

  const send = (channel: string, payload: unknown) => deps.getWindow()?.webContents.send(channel, payload)

  // BUG-53: lazily start the resident whisper-server with the live model, reused across recordings.
  // Started in the background on record-start so recording begins immediately; the live transcript
  // appears once the model has loaded (a few seconds). Kept warm until app-quit.
  const ensureServer = (binPath: string, liveModelPath: string): WhisperServer => {
    if (sharedServer?.running) return sharedServer
    sharedServer = new WhisperServer(binPath, liveModelPath, pickThreads(cpus().length))
    sharedServer.start().catch((err: Error) => {
      console.error('[desktop] whisper-server failed to start; live transcript unavailable:', err.message)
      sharedServer = null
      // Surface it: recording began immediately (audio is still captured for the stop-time final pass),
      // but the live view will never populate — tell the renderer so it shows the on-device-failed
      // banner rather than sitting silently empty. The captured audio still feeds finish()/diarize.
      send('local:error', 'On-device live transcription is unavailable (the local engine failed to start).')
    })
    return sharedServer
  }

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
    // 48-B: the small.en final model is best-effort — pass its path only if it has downloaded,
    // so the stop-time final pass runs when present and is skipped (live text kept) when it isn't.
    const finalPath = path.join(dir, finalModelFile())
    const finalModelPath = finalModelFile() && existsSync(finalPath) ? finalPath : undefined
    // Validate the live engine up front so a missing binary/model rejects here — the renderer then
    // takes its clean pre-recording cloud fallback instead of failing mid-recording.
    if (!existsSync(binPath)) throw new Error(`whisper binary not found at ${binPath}`)
    if (!existsSync(modelPath)) throw new Error(`whisper model not found at ${modelPath}`)
    // BUG-53: dispose any prior streaming session and kill in-flight CLI passes (final/diarize) —
    // the resident server stays warm across recordings. Then start a fresh streaming session over it.
    streaming?.dispose()
    killActiveWhisper()
    finalOpts = { binPath, finalModelPath }
    const server = ensureServer(binPath, modelPath)
    streaming = new StreamingSession(
      server,
      (text) => send('local:live', text),
      // Terminal only: StreamingSession calls this after a sustained run of failures against a READY
      // server (not the transient hiccups it tolerates), so surface it — the live view is dead. Audio
      // is still captured for the stop-time final pass, so this is a live-view warning, not a hard stop.
      (err) => {
        console.error('[desktop] live streaming failed:', err.message)
        send('local:error', 'On-device live transcription stopped responding.')
      },
    )
    streaming.start()
  })

  ipcMain.on('local:pcm', (_e, pcm: ArrayBuffer) => {
    streaming?.pushPcm(Buffer.from(pcm))
  })

  // 48-C: drop the live streaming session — used when source-separation diarization produced the
  // transcript instead, and as the stop-flow's guaranteed release. BUG-52: kill any in-flight CLI
  // final/diarize child; the resident server stays warm for the next recording.
  ipcMain.on('local:discard', () => {
    streaming?.dispose()
    streaming = null
    finalOpts = null
    killActiveWhisper()
  })

  // Stop streaming, then run the higher-quality small.en final pass over the whole recording (48-B,
  // via the CLI — unchanged). Returns the final transcript (or null → renderer keeps the live text).
  ipcMain.handle('local:finish', async (): Promise<string | null> => {
    const s = streaming
    const opts = finalOpts
    streaming = null
    finalOpts = null
    if (!s) return null
    s.stop()
    const audio = s.fullAudio()
    s.dispose()
    if (!opts?.finalModelPath || audio.length === 0) return null // keep the live streaming text
    try {
      const segs = await transcribeWindow(audio, 0, { binPath: opts.binPath, modelPath: opts.finalModelPath })
      const text = segs.map((x) => x.text).join(' ')
      return text.length ? text : null
    } catch (err) {
      console.error('[desktop] final pass failed; keeping live transcript:', (err as Error).message)
      return null
    }
  })

  // 48-C — 1:1 diarization by source separation. The renderer sends the separate mic ("me") and
  // loopback ("them") recordings; transcribe each with VAD and interleave into a Me/Them transcript.
  // Stateless (independent of the live session). Returns null when VAD/models are missing or there
  // is no speech → the renderer keeps the single-stream transcript.
  ipcMain.handle('local:diarize', async (_e, me: ArrayBuffer, them: ArrayBuffer): Promise<string | null> => {
    const dir = modelsDir(deps.userDataDir)
    const binPath = whisperBinPath(deps.resourcesPath)
    const liveSpec = MANIFEST.models.find(isLive)
    if (!liveSpec || !existsSync(binPath)) return null
    const modelPath = path.join(dir, liveSpec.file)
    const finalPath = finalModelFile() ? path.join(dir, finalModelFile()) : ''
    const vadPath = vadModelFile() ? path.join(dir, vadModelFile()) : ''
    // VAD is mandatory for source separation; without it, fall back to the single-stream path.
    if (!vadPath || !existsSync(vadPath)) return null
    if (!existsSync(modelPath)) return null
    try {
      return await diarizeStreams(Buffer.from(me), Buffer.from(them), {
        binPath,
        modelPath,
        finalModelPath: finalPath && existsSync(finalPath) ? finalPath : undefined,
        vadModelPath: vadPath,
      })
    } catch (err) {
      console.error('[desktop] diarization failed; keeping single-stream transcript:', (err as Error).message)
      return null
    }
  })
}
