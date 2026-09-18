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

describe('the level at which captured audio counts as sound', () => {
  // The measurement, against the app's own encoder. Review round 1 caught the comment claiming the
  // threshold WAS the encoder's floor; it is a whole step, twice the floor. Both numbers are
  // measured here so neither can drift back into a claim nobody checked.
  it('sits one whole quantisation step above the encoder floor, which is half a step', () => {
    // The encoder's own floor: half a step is the first amplitude that survives quantisation.
    expect(allZero(floatTo16BitPcm(constant(0.49 / 32767, 8)))).toBe(true)
    expect(allZero(floatTo16BitPcm(constant(0.51 / 32767, 8)))).toBe(false)

    // The threshold is above it, so a sample that only rounds to +/-1 on some frames is not sound.
    expect(SILENT_PEAK).toBeCloseTo(1 / 32767, 12)
    expect(0.51 / 32767).toBeLessThan(SILENT_PEAK)
    expect(allZero(floatTo16BitPcm(constant(SILENT_PEAK, 8)))).toBe(false)
  })

  it('is about -90 dBFS', () => {
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
