import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { LocalTranscriptionSession, transcribeWindow, encodeWav } from '../src/localTranscription'
import type { WhisperSegment } from '../src/whisperParse'

// 48-A — end-to-end proof of the local engine against a REAL whisper-cli binary + model.
// Skipped unless WHISPER_TEST_BIN / WHISPER_TEST_MODEL / WHISPER_TEST_WAV are set (CI has no
// binary), so it runs locally/on the author's machine and never red-fails CI. The Windows
// equivalent is a manual check (MANUAL-VERIFICATION.md). Proves: PCM window → whisper → parsed
// speech text, and the session's ordered multi-window streaming.
const BIN = process.env.WHISPER_TEST_BIN
const MODEL = process.env.WHISPER_TEST_MODEL
const WAV = process.env.WHISPER_TEST_WAV
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

  test('session streams ordered segments across multiple windows and flushes the tail', async () => {
    const pcm = pcmFromWav(WAV!).subarray(0, 16000 * 2 * 12) // 12s → two 5s windows + tail
    const got: WhisperSegment[] = []
    let err: Error | null = null
    const session = new LocalTranscriptionSession(
      { binPath: BIN!, modelPath: MODEL!, windowSeconds: 5, threads: 8 },
      (segs) => got.push(...segs),
      (e) => (err = e),
    )
    // feed in ~1s chunks, as the renderer would
    for (let off = 0; off < pcm.length; off += 16000 * 2) {
      session.pushPcm(pcm.subarray(off, off + 16000 * 2))
    }
    await session.finish()
    expect(err).toBeNull()
    expect(got.length).toBeGreaterThan(0)
    // baseMs is non-decreasing (ordered timeline) and a later window crossed 5s
    for (let i = 1; i < got.length; i++) expect(got[i].startMs).toBeGreaterThanOrEqual(got[i - 1].startMs)
    expect(got.some((s) => s.startMs >= 5000)).toBe(true)
  })

  // 48-B — the stop-time final pass re-transcribes the WHOLE recording with the final model.
  // Uses base.en as the final-model stand-in (medium.en is 1.5 GB; real quality is manual-Windows) —
  // this proves the mechanism: finish() then runFinalPass() returns the full-recording transcript.
  test('runFinalPass re-transcribes the full recording and returns joined text', async () => {
    const pcm = pcmFromWav(WAV!).subarray(0, 16000 * 2 * 12) // 12s
    const session = new LocalTranscriptionSession(
      { binPath: BIN!, modelPath: MODEL!, finalModelPath: MODEL!, windowSeconds: 5, threads: 8 },
      () => {},
      () => {},
    )
    for (let off = 0; off < pcm.length; off += 16000 * 2) session.pushPcm(pcm.subarray(off, off + 16000 * 2))
    await session.finish()
    const finalText = await session.runFinalPass()
    expect(finalText).not.toBeNull()
    expect(finalText!.length).toBeGreaterThan(20)
  })

  test('runFinalPass returns null when no final model is configured (keep the live text)', async () => {
    const session = new LocalTranscriptionSession(
      { binPath: BIN!, modelPath: MODEL!, threads: 8 }, // no finalModelPath
      () => {},
      () => {},
    )
    session.pushPcm(pcmFromWav(WAV!).subarray(0, 16000 * 2 * 3))
    await session.finish()
    expect(await session.runFinalPass()).toBeNull()
  })
})
