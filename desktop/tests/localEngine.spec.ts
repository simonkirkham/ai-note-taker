import { test, expect } from '@playwright/test'
import { pickThreads } from '../src/localEngine'

// 48-A / BUG-52 — the thread cap is pure so it unit-tests headlessly (the real whisper spawn is
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
