import { test, expect } from '@playwright/test'
import { PcmWindower, pickThreads } from '../src/localEngine'

// 48-A — the live-window slicing is pure so it unit-tests headlessly (the real whisper spawn is
// manual-on-Windows). The engine-selection decision is renderer-side and covered by the web
// useTranscriptionMode tests.

// BUG-52 — thread cap: half the cores (min 1) so whisper never pegs the whole machine.
test('pickThreads defaults to half the cores, minimum 1, capped at 8', () => {
  expect(pickThreads(16)).toBe(8)
  expect(pickThreads(8)).toBe(4)
  expect(pickThreads(4)).toBe(2)
  expect(pickThreads(1)).toBe(1)
  expect(pickThreads(0)).toBe(1) // unknown cpu count → at least 1
  expect(pickThreads(32)).toBe(8) // capped — whisper scaling plateaus ~8
})

test('pickThreads honours an explicit positive request', () => {
  expect(pickThreads(4, 8)).toBe(8)
  expect(pickThreads(16, 1)).toBe(1)
})

test('pickThreads ignores a non-positive request and falls back to the cap', () => {
  expect(pickThreads(8, 0)).toBe(4)
})

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
