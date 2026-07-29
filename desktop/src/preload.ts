import { contextBridge, ipcRenderer } from 'electron'

// 48-A / BUG-53 — extend the sandbox-safe bridge with a local-transcription surface. The renderer
// streams PCM to the main process (resident whisper-server) and receives the live transcript back.
// Only ipcRenderer is used here (sandbox: true) — no Node.

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
    // 48-C: diarize a 1:1 call from the separate mic ("me") + loopback ("them") recordings,
    // resolving with a Me/Them transcript (or null → keep the single-stream text).
    diarize: (me: ArrayBuffer, them: ArrayBuffer): Promise<string | null> =>
      ipcRenderer.invoke('local:diarize', me, them),
    // 48-C: drop the live session without its final pass (diarization produced the transcript).
    discard: (): void => ipcRenderer.send('local:discard'),
    // BUG-53: the current live transcript (a full string: committed text + settling tail), emitted
    // ~every 1.5s by the streaming session. The renderer sets the transcript to it (replace, not append).
    onLive: (cb: (text: string) => void) => {
      const h = (_e: unknown, text: string) => cb(text)
      ipcRenderer.on('local:live', h)
      return () => ipcRenderer.removeListener('local:live', h)
    },
    onError: (cb: (message: string) => void) => {
      const h = (_e: unknown, message: string) => cb(message)
      ipcRenderer.on('local:error', h)
      return () => ipcRenderer.removeListener('local:error', h)
    },
  },
})
