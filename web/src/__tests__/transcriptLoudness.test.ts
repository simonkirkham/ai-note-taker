import { floatTo16BitPcm } from '../hooks/pcm'
import {
  LOUDNESS_FLOOR_DBFS,
  SILENT_PEAK,
  SPEECH_PEAK,
  TranscriptHealthTracker,
  peakOf,
} from '../hooks/transcriptHealth'

// BUG-85 — when a transcript stops, the record has to say whether people were still speaking. The
// silence floor catches only a dead source: a quiet room reads as "sound" exactly like speech. So
// the record now carries how loud the captured audio was. These specs pin the numbers to what the
// app actually TRANSMITS, measured through its own encoder, rather than restating them.

const T0 = 1_700_000_000_000
const RATE = 16000

function constant(amplitude: number, samples = 1600): Float32Array {
  return new Float32Array(samples).fill(amplitude)
}

// The level of an encoded chunk as the transcription service receives it: the loudest 16-bit
// sample, in dB relative to full scale.
function encodedDbfs(frame: Float32Array): number {
  const pcm = new Int16Array(floatTo16BitPcm(frame).buffer)
  let peak = 0
  for (const sample of pcm) peak = Math.max(peak, Math.abs(sample))
  return 20 * Math.log10(peak / 32767)
}

function trackerAfter(frames: Float32Array[]): TranscriptHealthTracker {
  const tracker = new TranscriptHealthTracker()
  tracker.recordingStarted('cloud', RATE, T0)
  for (const frame of frames) tracker.audioLevel(peakOf(frame), frame.length, T0 + 1000)
  return tracker
}

describe('the loudness the record reports', () => {
  it.each([0.9, 0.2, 0.05, 0.01, 0.003, 0.0005])(
    'reports amplitude %s at the level the encoder actually transmits',
    (amplitude) => {
      const frame = constant(amplitude)
      const reported = trackerAfter([frame]).snapshot('inProgress', T0 + 2000).loudestDbfs

      expect(reported).not.toBeNull()
      expect(Math.abs(reported! - encodedDbfs(frame))).toBeLessThanOrEqual(0.05)
    },
  )

  it('reports the loudest frame in the window, not the last one', () => {
    const reported = trackerAfter([constant(0.003), constant(0.2), constant(0.01)]).snapshot('inProgress', T0 + 2000)

    expect(reported.loudestDbfs).toBeCloseTo(encodedDbfs(constant(0.2)), 1)
  })

  // A zero-filled buffer has no finite level. JSON cannot carry -Infinity, and reporting null would
  // read on the server as "an old build that never measured" — so it reports the floor instead.
  it('reports digital silence at the floor, below anything the encoder can transmit', () => {
    const reported = trackerAfter([constant(0)]).snapshot('inProgress', T0 + 2000).loudestDbfs

    expect(reported).toBe(LOUDNESS_FLOOR_DBFS)
    expect(LOUDNESS_FLOOR_DBFS).toBeLessThan(encodedDbfs(constant(0.51 / 32767)))
  })

  it('reports the floor when no audio at all has arrived in the window', () => {
    expect(trackerAfter([]).snapshot('inProgress', T0 + 2000).loudestDbfs).toBe(LOUDNESS_FLOOR_DBFS)
  })

  it('never reports above full scale, however hot the captured samples', () => {
    expect(trackerAfter([constant(1.7)]).snapshot('inProgress', T0 + 2000).loudestDbfs).toBe(0)
  })
})

describe('the level at which captured audio counts as speech', () => {
  it('is -40 dBFS on the loudest sample of a frame', () => {
    expect(20 * Math.log10(SPEECH_PEAK)).toBeCloseTo(-40, 6)
  })

  // Speech well inside the conversational range survives the encoder above the threshold; room tone
  // survives it too (it is not silence) but lands below.
  it('separates conversational speech from room tone, both measured through the encoder', () => {
    expect(encodedDbfs(constant(0.03))).toBeGreaterThan(20 * Math.log10(SPEECH_PEAK)) // about -30 dBFS
    expect(encodedDbfs(constant(0.003))).toBeLessThan(20 * Math.log10(SPEECH_PEAK)) // about -50 dBFS
    expect(peakOf(constant(0.003))).toBeGreaterThan(SILENT_PEAK)
  })

  it('counts the seconds of speech-level audio by samples, not by how often frames arrive', () => {
    // 128-sample worklet frames, as the browser delivers them: 125 of them is exactly one second.
    const frames = Array.from({ length: 250 }, (_, i) => constant(i < 125 ? 0.2 : 0.003, 128))

    expect(trackerAfter(frames).snapshot('inProgress', T0 + 2000).speechSeconds).toBe(1)
  })
})
