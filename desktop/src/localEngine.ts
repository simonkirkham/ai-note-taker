// 48-A — pure local-transcription logic (no electron, no child_process), unit-tested
// headlessly. The real whisper spawn lives in localTranscription.ts and is manual-on-Windows.

export type TranscriptionMode = 'local' | 'cloud'

// Which STT engine to actually run. Cloud is the always-available safe path; local is
// used only when the user selected it AND the model is present AND it hasn't failed this
// session. Mirrors displayMedia's "fall back to the safe option when the preferred one
// isn't available" so a missing model or a mid-recording crash never yields no transcript.
export function chooseEngine(opts: {
  mode: TranscriptionMode
  modelReady: boolean
  localFailed: boolean
}): TranscriptionMode {
  if (opts.mode === 'local' && opts.modelReady && !opts.localFailed) return 'local'
  return 'cloud'
}

type Window = { pcm: Buffer; baseMs: number }

// Slices the incoming 16-bit PCM stream into consecutive fixed-length windows. Each window
// is transcribed by an independent whisper pass; baseMs maps its segments back onto the
// recording timeline. Non-overlapping windows keep 48-A simple — boundary words may split,
// which the 48-B medium.en full-recording pass fixes for the saved transcript.
export class PcmWindower {
  private readonly windowSamples: number
  private buffered: Buffer[] = []
  private bufferedSamples = 0
  private consumedSamples = 0

  constructor(private readonly sampleRate: number, windowSeconds: number) {
    this.windowSamples = Math.round(sampleRate * windowSeconds)
  }

  push(chunk: Buffer): void {
    if (chunk.length === 0) return
    this.buffered.push(chunk)
    this.bufferedSamples += chunk.length / 2
  }

  // Return the next full window if one has accumulated, else null.
  takeWindow(): Window | null {
    if (this.bufferedSamples < this.windowSamples) return null
    return this.cut(this.windowSamples)
  }

  // On stop, emit whatever audio remains as a final (short) window.
  flush(): Window | null {
    if (this.bufferedSamples === 0) return null
    return this.cut(this.bufferedSamples)
  }

  private cut(samples: number): Window {
    const bytes = samples * 2
    const joined = Buffer.concat(this.buffered)
    const pcm = joined.subarray(0, bytes)
    const rest = joined.subarray(bytes)
    this.buffered = rest.length ? [rest] : []
    this.bufferedSamples -= samples
    const baseMs = Math.round((this.consumedSamples / this.sampleRate) * 1000)
    this.consumedSamples += samples
    return { pcm, baseMs }
  }
}
