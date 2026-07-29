import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { transcribeWindow, encodeWav, diarizeStreams } from '../src/localTranscription'

// 48-A / BUG-53 — end-to-end proof of the batch whisper-cli passes against a REAL binary + model.
// Skipped unless WHISPER_TEST_BIN / WHISPER_TEST_MODEL / WHISPER_TEST_WAV are set (CI has no
// binary), so it runs locally/on the author's machine and never red-fails CI. The Windows
// equivalent is a manual check (MANUAL-VERIFICATION.md). Proves: PCM window → whisper → parsed
// speech text (the stop-time final pass), and source-separation diarization. The live streaming
// path is proven separately in whisperServer.integration.spec.ts.
const BIN = process.env.WHISPER_TEST_BIN
const MODEL = process.env.WHISPER_TEST_MODEL
const WAV = process.env.WHISPER_TEST_WAV
const VAD = process.env.WHISPER_TEST_VAD // 48-C: silero VAD model
const ready = Boolean(BIN && MODEL && WAV)

// Read 16 kHz mono 16-bit PCM out of a WAV (skip the 44-byte header).
function pcmFromWav(file: string): Buffer {
  return readFileSync(file).subarray(44)
}

test('encodeWav round-trips PCM length into a 44-byte-header WAV', () => {
  const pcm = Buffer.alloc(16000 * 2) // 1s
  const wav = encodeWav(pcm, 16000)
  expect(wav.length).toBe(44 + pcm.length)
  expect(wav.toString('ascii', 0, 4)).toBe('RIFF')
  expect(wav.toString('ascii', 8, 12)).toBe('WAVE')
})

test.describe('real whisper-cli', () => {
  test.skip(!ready, 'set WHISPER_TEST_BIN / WHISPER_TEST_MODEL / WHISPER_TEST_WAV to run')

  test('transcribes one 10s window into real speech text', async () => {
    const pcm = pcmFromWav(WAV!).subarray(0, 16000 * 2 * 10) // first 10s
    const segs = await transcribeWindow(pcm, 0, { binPath: BIN!, modelPath: MODEL!, threads: 8 })
    const text = segs.map((s) => s.text).join(' ').toLowerCase()
    expect(segs.length).toBeGreaterThan(0)
    expect(text.length).toBeGreaterThan(20)
  })
})

// 48-C — source-separation diarization against the real binary + VAD model. Uses two different
// slices of the meeting as the "me" and "them" streams (real 2-channel capture is manual-Windows).
test.describe('real whisper-cli diarization (48-C)', () => {
  test.skip(!(ready && VAD), 'set WHISPER_TEST_VAD (+ the others) to run')

  test('diarizeStreams merges two streams into a Me/Them transcript', async () => {
    const pcm = pcmFromWav(WAV!)
    const me = pcm.subarray(0, 16000 * 2 * 10) // 0–10 s
    const them = pcm.subarray(16000 * 2 * 10, 16000 * 2 * 20) // 10–20 s
    const text = await diarizeStreams(me, them, { binPath: BIN!, modelPath: MODEL!, vadModelPath: VAD!, threads: 8 })
    expect(text).not.toBeNull()
    expect(text!).toMatch(/^(Me|Them): /m) // at least one labelled line
    expect(text!).toContain('Me:')
    expect(text!).toContain('Them:')
  })

  test('diarizeStreams returns null without a VAD model (VAD is mandatory)', async () => {
    const me = pcmFromWav(WAV!).subarray(0, 16000 * 2 * 3)
    const text = await diarizeStreams(me, Buffer.alloc(0), { binPath: BIN!, modelPath: MODEL!, threads: 8 })
    expect(text).toBeNull()
  })
})
