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
import {
  ensureModels,
  modelsDir,
  whisperBinPath,
  whisperServerBinPath,
  finalModelFile,
  vadModelFile,
  MANIFEST,
} from './modelStore'
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
  // BUG-56: a start failure can land AFTER the renderer has stopped listening. start() gives up at
  // 60s, but the renderer detaches its local:error listener as soon as finish() resolves — so a
  // short recording against a permanently-stalled engine would see the failure sent into a window
  // with no listener and dropped, leaving the original silent symptom for anyone who only records
  // briefly (exactly how this fix gets tested). Hold it and replay it on the next recording.
  let pendingStartFailure: string | null = null
  // Whether THIS recording's session already told the user something. A session message is always
  // more specific than the generic start failure, so it must not be overwritten by one.
  let sessionReported = false

  const ensureServer = (binPath: string, liveModelPath: string): WhisperServer => {
    // A warm server is reused as-is, so both arguments are IGNORED on that path. No caller varies
    // them today, but silently reusing a server built from a different binary is the exact shape
    // that produced BUG-56 — say so loudly if it ever starts happening.
    if (sharedServer?.running) {
      if (!sharedServer.matches(binPath, liveModelPath)) {
        // Log BOTH sides — knowing only what was wanted can't tell you what you actually got, which
        // is the half you need to diagnose.
        console.error('[desktop] reusing a warm whisper-server started with a DIFFERENT binary/model', {
          wanted: { binPath, modelPath: liveModelPath },
          actual: sharedServer.describe(),
        })
      }
      return sharedServer
    }
    sharedServer = new WhisperServer(binPath, liveModelPath, pickThreads(cpus().length))
    sharedServer
      .start()
      .then(() => {
        pendingStartFailure = null // it came up — nothing left to replay
      })
      .catch((err: Error) => {
        console.error('[desktop] whisper-server failed to start; live transcript unavailable:', err.message)
        sharedServer = null
        // Surface it: recording began immediately (audio is still captured for the stop-time final
        // pass), but the live view will never populate — tell the renderer so it shows the
        // on-device-failed banner rather than sitting silently empty. The captured audio still feeds
        // finish()/diarize. Send the bare CAUSE: the renderer frames it ("On-device transcription
        // failed: …"), so a sentence here reads as "failed: … failed — …".
        pendingStartFailure = 'the local engine failed to start'
        // Don't overwrite a more specific message the session already showed — the user's
        // information must not get vaguer as time passes.
        if (!sessionReported) send('local:error', pendingStartFailure)
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
    // BUG-56: the resident live path needs whisper-server, NOT the CLI — a distinct binary from
    // the same bundle. Passing binPath here was the whole defect: whisper-cli exits on --host.
    const serverBinPath = whisperServerBinPath(deps.resourcesPath)
    const dir = modelsDir(deps.userDataDir)
    const liveSpec = MANIFEST.models.find(isLive)
    if (!liveSpec) throw new Error('no live model configured in the manifest')
    const modelPath = path.join(dir, liveSpec.file)
    // 48-B: the small.en final model is best-effort — pass its path only if it has downloaded,
    // so the stop-time final pass runs when present and is skipped (live text kept) when it isn't.
    const finalPath = path.join(dir, finalModelFile())
    const finalModelPath = finalModelFile() && existsSync(finalPath) ? finalPath : undefined
    // Validate the BATCH binary + the live model up front so a missing one rejects here — the
    // renderer then takes its clean pre-recording cloud fallback instead of failing mid-recording.
    // Note the deliberate asymmetry with the server binary below: without the CLI there is no
    // stop-time pass, so local mode cannot produce a transcript at all and cloud is the only way to
    // get one; without the server, only the LIVE view is lost and local still delivers. Both
    // binaries ship from the same staging step, so in practice neither is missing alone.
    if (!existsSync(binPath)) throw new Error(`whisper binary not found at ${binPath}`)
    if (!existsSync(modelPath)) throw new Error(`whisper model not found at ${modelPath}`)
    // BUG-56: a missing SERVER binary deliberately does NOT throw. Throwing would make the renderer
    // fall back to cloud, streaming this meeting's audio to AWS — the opposite of what someone who
    // chose on-device mode asked for (and at odds with 48-E). Recording continues locally: the live
    // view is dead but the stop-time pass still produces a transcript.
    sessionReported = false
    const serverPresent = existsSync(serverBinPath)
    if (!serverPresent) {
      console.error('[desktop] whisper-server binary missing at', serverBinPath)
      send('local:error', 'the local engine is missing from this installation')
      sessionReported = true
    } else if (pendingStartFailure) {
      // A previous recording's start failure landed after its window stopped listening. Replay it
      // now rather than requiring the user to observe the failure live to ever hear about it.
      send('local:error', pendingStartFailure)
    }
    // BUG-53: dispose any prior streaming session and kill in-flight CLI passes (final/diarize) —
    // the resident server stays warm across recordings. Then start a fresh streaming session over it.
    streaming?.dispose()
    killActiveWhisper()
    finalOpts = { binPath, finalModelPath }
    // Skip ensureServer entirely when the binary is absent: spawning it anyway would reject on
    // ENOENT a moment later and overwrite the precise message above with a vaguer one. An unstarted
    // server reports running === false, so the session stays quiet, keeps buffering PCM for the
    // stop-time pass, and sharedServer stays null so the next recording retries cleanly.
    const server = serverPresent
      ? ensureServer(serverBinPath, modelPath)
      : new WhisperServer(serverBinPath, modelPath, pickThreads(cpus().length))
    streaming = new StreamingSession(
      server,
      (text) => send('local:live', text),
      // Terminal only: StreamingSession calls this after a sustained run of failures against a READY
      // server (not the transient hiccups it tolerates), or when the server never became ready at
      // all — the live view is dead either way. Audio is still captured for the stop-time final
      // pass, so this is a live-view warning, not a hard stop. BUG-56: forward the session's own
      // message; it distinguishes "stopped during the recording" from "never finished loading", and
      // a fixed string here would have discarded exactly the diagnosis the user needs. Bare cause —
      // the renderer supplies the "On-device transcription failed:" frame.
      (err) => {
        // The raw transport error rides along as `cause` — kept out of the banner, kept in the log.
        console.error('[desktop] live streaming failed:', err.message, err.cause ?? '')
        sessionReported = true
        send('local:error', err.message)
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
