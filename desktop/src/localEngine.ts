// 48-A — pure PCM windowing (no electron, no child_process), unit-tested headlessly. The real
// whisper spawn lives in localTranscription.ts and is manual-on-Windows. The engine-selection
// decision (local vs cloud) lives renderer-side in useTranscriptionMode/useTranscription, where
// it is tested against localStorage + the desktop model-ready status.

// BUG-52: cap whisper threads so on-device transcription never pegs the whole machine (it ran
// at 8 threads, oversubscribing a 4-core laptop → thrash + "used a lot of resource"). Use half
// the cores (min 1), leaving headroom for the app + the OS, and cap at 8 (whisper.cpp thread
// scaling plateaus ~4-8, so more is wasted contention). An explicit request still wins.
export function pickThreads(cpuCount: number, requested?: number): number {
  if (requested && requested > 0) return requested
  return Math.min(8, Math.max(1, Math.floor((cpuCount || 1) / 2)))
}

type Window = { pcm: Buffer; baseMs: number }

// Slices the incoming 16-bit PCM stream into consecutive fixed-length windows. Each window
// is transcribed by an independent whisper pass; baseMs maps its segments back onto the
// recording timeline. Non-overlapping windows keep 48-A simple — boundary words may split,
// which the 48-B small.en full-recording pass fixes for the saved transcript.
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
