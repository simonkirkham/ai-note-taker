import { contextBridge, ipcRenderer } from 'electron'
import type { WhisperSegment } from './whisperParse'

// 48-A — extend the sandbox-safe bridge with a local-transcription surface. The renderer
// streams PCM to the main process (which runs whisper-cli) and receives parsed segments back.
// Only ipcRenderer is used here (sandbox: true) — no Node. Contract mirrors phase-48.md:151.

export type LocalStatus = { modelReady: boolean; downloading: boolean; progress: number }

contextBridge.exposeInMainWorld('desktop', {
  isDesktop: true,
  platform: process.platform,
  local: {
    // Ask the main process to background-download models (idempotent). Called when the user
    // selects local mode, so cloud-only users never pull the weights.
    prepare: (): void => ipcRenderer.send('local:prepare'),
    // Current model-provisioning state.
    getStatus: (): Promise<LocalStatus> => ipcRenderer.invoke('local:status'),
    onStatus: (cb: (s: LocalStatus) => void) => {
      const h = (_e: unknown, s: LocalStatus) => cb(s)
      ipcRenderer.on('local:status', h)
      return () => ipcRenderer.removeListener('local:status', h)
    },
    // Begin a recording's local transcription session (one at a time).
    start: (): Promise<void> => ipcRenderer.invoke('local:start'),
    // Stream captured 16-bit PCM (transferred as an ArrayBuffer).
    pushPcm: (pcm: ArrayBuffer): void => ipcRenderer.send('local:pcm', pcm),
    // Flush the tail, run the higher-quality final pass, and resolve with the final transcript
    // text (or null → keep the live text). Resolves before the renderer commits.
    finish: (): Promise<string | null> => ipcRenderer.invoke('local:finish'),
    onSegments: (cb: (segs: WhisperSegment[]) => void) => {
      const h = (_e: unknown, segs: WhisperSegment[]) => cb(segs)
      ipcRenderer.on('local:segments', h)
      return () => ipcRenderer.removeListener('local:segments', h)
    },
    onError: (cb: (message: string) => void) => {
      const h = (_e: unknown, message: string) => cb(message)
      ipcRenderer.on('local:error', h)
      return () => ipcRenderer.removeListener('local:error', h)
    },
  },
})
