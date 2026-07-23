import { test, expect } from '@playwright/test'
import { PcmWindower } from '../src/localEngine'

// 48-A — the live-window slicing is pure so it unit-tests headlessly (the real whisper spawn is
// manual-on-Windows). The engine-selection decision is renderer-side and covered by the web
// useTranscriptionMode tests.

// PcmWindower slices the incoming 16-bit PCM stream into consecutive fixed-length
// windows (each transcribed independently by a whisper pass), tracking the base offset
// so segments map back onto the recording timeline. 16 kHz mono → 16000 samples/s.
const SR = 16000

function chunk(samples: number): Buffer {
  return Buffer.alloc(samples * 2) // 16-bit
}

test('emits a window once a full window of audio has accumulated', () => {
  const w = new PcmWindower(SR, 5) // 5-second windows
  expect(w.takeWindow()).toBeNull() // nothing yet
  w.push(chunk(SR * 3)) // 3s
  expect(w.takeWindow()).toBeNull() // under a window
  w.push(chunk(SR * 3)) // now 6s buffered
  const win = w.takeWindow()
  expect(win).not.toBeNull()
  expect(win!.baseMs).toBe(0)
  expect(win!.pcm.length).toBe(SR * 5 * 2) // exactly one 5s window
  expect(w.takeWindow()).toBeNull() // only 1s left over
})

test('successive windows advance baseMs by the window length', () => {
  const w = new PcmWindower(SR, 5)
  w.push(chunk(SR * 12)) // 12s → two full 5s windows + 2s tail
  expect(w.takeWindow()!.baseMs).toBe(0)
  expect(w.takeWindow()!.baseMs).toBe(5000)
  expect(w.takeWindow()).toBeNull()
})

test('flush emits the remaining tail as a final window on stop', () => {
  const w = new PcmWindower(SR, 5)
  w.push(chunk(SR * 7)) // one full window + 2s
  expect(w.takeWindow()!.baseMs).toBe(0)
  const tail = w.flush()
  expect(tail).not.toBeNull()
  expect(tail!.baseMs).toBe(5000)
  expect(tail!.pcm.length).toBe(SR * 2 * 2) // the 2s remainder
  expect(w.flush()).toBeNull() // nothing left
})

test('flush with no leftover returns null', () => {
  const w = new PcmWindower(SR, 5)
  w.push(chunk(SR * 5))
  expect(w.takeWindow()).not.toBeNull()
  expect(w.flush()).toBeNull()
})
