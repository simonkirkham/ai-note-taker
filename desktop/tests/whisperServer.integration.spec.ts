import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { WhisperServer } from '../src/whisperServer'

// BUG-53 — end-to-end proof of the resident whisper-server against the REAL binary. Skipped unless
// WHISPER_SERVER_BIN / WHISPER_TEST_MODEL / WHISPER_TEST_WAV are set (CI has no binary). Proves:
// the server starts (model loaded once), transcribes fed PCM into timestamped segments, and stays
// resident across requests (the whole point — no per-window reload). Windows capture is manual.
const BIN = process.env.WHISPER_SERVER_BIN
const MODEL = process.env.WHISPER_TEST_MODEL
const WAV = process.env.WHISPER_TEST_WAV
const ready = Boolean(BIN && MODEL && WAV)

function pcmFromWav(file: string): Buffer {
  return readFileSync(file).subarray(44)
}

test.describe('real whisper-server (48-BUG-53)', () => {
  test.skip(!ready, 'set WHISPER_SERVER_BIN / WHISPER_TEST_MODEL / WHISPER_TEST_WAV to run')
  test.setTimeout(120_000)

  test('starts resident, transcribes two windows without reloading the model', async () => {
    const server = new WhisperServer(BIN!, MODEL!, 6)
    await server.start()
    try {
      expect(server.running).toBe(true)
      const pcm = pcmFromWav(WAV!)
      const w1 = pcm.subarray(0, 16000 * 2 * 5) // 0-5s
      const w2 = pcm.subarray(16000 * 2 * 5, 16000 * 2 * 10) // 5-10s

      const t0 = Date.now()
      const segs1 = await server.transcribe(w1, 0)
      const first = Date.now() - t0

      const t1 = Date.now()
      const segs2 = await server.transcribe(w2, 5000)
      const second = Date.now() - t1

      expect(segs1.length).toBeGreaterThan(0)
      expect(segs2.length).toBeGreaterThan(0)
      expect(segs1.map((s) => s.text).join(' ').length).toBeGreaterThan(10)
      // second request has no model-load cost — it should not be dramatically slower than the first
      // (both are pure inference on the resident model). Loose bound: within 3x.
      expect(second).toBeLessThan(first * 3 + 2000)
      // baseMs offset applied to the second window
      expect(segs2[0].startMs).toBeGreaterThanOrEqual(5000)
    } finally {
      server.kill()
      expect(server.running).toBe(false)
    }
  })

  test('transcribe rejects after kill', async () => {
    const server = new WhisperServer(BIN!, MODEL!, 6)
    await server.start()
    server.kill()
    await expect(server.transcribe(Buffer.alloc(16000 * 2), 0)).rejects.toThrow()
  })
})
