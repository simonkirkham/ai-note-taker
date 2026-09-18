import { floatTo16BitPcm } from '../hooks/pcm'
import { SILENT_PEAK, peakOf } from '../hooks/transcriptHealth'

// BUG-85 slice 1 — "no sound is being picked up" has to mean something exact, or the app will
// either miss a dead microphone or accuse a quiet room. The threshold is not a guess: it is the
// level below which the audio the app TRANSMITS is literally all-zero bytes, measured here against
// the app's own encoder. Below it the transcription service receives digital silence whatever the
// analogue signal was, so there is nothing for it to turn into words.

function constant(amplitude: number, samples = 1600): Float32Array {
  return new Float32Array(samples).fill(amplitude)
}

function allZero(bytes: Uint8Array): boolean {
  return bytes.every((b) => b === 0)
}

describe('the level at which transmitted audio becomes digital silence', () => {
  // The measurement itself: walk the encoder down until every transmitted byte is zero.
  it('is the point where the 16-bit encoder stops producing a non-zero sample', () => {
    expect(allZero(floatTo16BitPcm(constant(SILENT_PEAK, 8)))).toBe(false)

    // Just under half a quantisation step: everything the app sends is zero.
    expect(allZero(floatTo16BitPcm(constant(0.49 / 32767, 8)))).toBe(true)
  })

  it('places the threshold at one whole quantisation step, about -90 dBFS', () => {
    expect(SILENT_PEAK).toBeCloseTo(1 / 32767, 12)
    expect(20 * Math.log10(SILENT_PEAK)).toBeCloseTo(-90.3, 1)
  })

  // A dead or muted track delivers zero-filled buffers at the normal rate, which is exactly why
  // counting buffers pushed could never tell it from speech.
  it('calls a zero-filled buffer — what a dead or muted track delivers — silent', () => {
    expect(peakOf(constant(0))).toBe(0)
    expect(peakOf(constant(0))).toBeLessThan(SILENT_PEAK)
  })

  // Room tone from a live microphone sits three orders of magnitude above the threshold, so a
  // genuinely quiet meeting is never reported as no sound.
  it('leaves quiet room tone comfortably above the threshold', () => {
    expect(peakOf(constant(0.001))).toBeGreaterThan(SILENT_PEAK)
  })

  it('measures the loudest sample in the buffer, in either direction', () => {
    expect(peakOf(new Float32Array([0, 0.02, -0.4, 0.1]))).toBeCloseTo(0.4, 6)
  })
})
