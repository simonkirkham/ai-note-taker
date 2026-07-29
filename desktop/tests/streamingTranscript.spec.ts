import { test, expect } from '@playwright/test'
import { reduceStream as reduce, initStreamState as init } from '../src/streamingTranscript'
import { parseServerSegments } from '../src/whisperServer'
import type { WhisperSegment } from '../src/whisperParse'

// BUG-53 — pure streaming reducer + server-JSON parse. Headless.
const seg = (startMs: number, endMs: number, text: string): WhisperSegment => ({ startMs, endMs, text })
const cfg = { stabilityMs: 1500, maxWindowMs: 8000 }

test('below the window threshold, nothing commits — the whole window is the live tail', () => {
  const now = 4000 // window 0..4000 < 8000 max → no commit
  const { state, display } = reduce(init(), [seg(0, 2000, 'hello there'), seg(2000, 4000, 'how are you')], now, cfg)
  expect(state.committed).toBe('')
  expect(state.finalizedMs).toBe(0)
  expect(display).toBe('hello there how are you')
})

test('past the window threshold, settled segments commit and finalizedMs advances', () => {
  const now = 9000 // window 0..9000 >= 8000; settledEdge = 7500
  const segs = [seg(0, 3000, 'one'), seg(3000, 6000, 'two'), seg(6000, 8000, 'three'), seg(8000, 9000, 'four')]
  const { state, display } = reduce(init(), segs, now, cfg)
  // ends 3000/6000 <= 7500 → committed; 8000/9000 > 7500 → live tail
  expect(state.committed).toBe('one two')
  expect(state.finalizedMs).toBe(6000)
  expect(display).toBe('one two three four')
})

test('committed text carries forward across steps and the window re-bases to finalizedMs', () => {
  let s = init()
  ;({ state: s } = reduce(s, [seg(0, 3000, 'alpha'), seg(3000, 6000, 'beta'), seg(6000, 8500, 'gamma')], 8500, cfg))
  expect(s.committed).toBe('alpha beta') // 3000,6000 settled (<7000); gamma end 8500 live
  expect(s.finalizedMs).toBe(6000)
  // next window is [6000, 15000]; server re-transcribes from 6000; new segments are absolute
  const next = reduce(s, [seg(6000, 9000, 'gamma'), seg(9000, 13000, 'delta'), seg(13000, 15000, 'epsilon')], 15000, cfg)
  expect(next.state.committed).toBe('alpha beta gamma delta') // ends 9000,13000 <= 13500 settled
  expect(next.display).toBe('alpha beta gamma delta epsilon')
})

test('empty window keeps the committed text', () => {
  const s = { committed: 'kept', finalizedMs: 6000 }
  const { state, display } = reduce(s, [], 10000, cfg)
  expect(state.committed).toBe('kept')
  expect(display).toBe('kept')
})

test('parseServerSegments: seconds → ms, baseMs offset, drops non-speech', () => {
  const json = {
    segments: [
      { start: 0, end: 2, text: ' Hello there.' },
      { start: 2, end: 3, text: '[BLANK_AUDIO]' },
      { start: 3, end: 5, text: ' Next.' },
    ],
  }
  const out = parseServerSegments(json, 6000)
  expect(out.map((s) => s.text)).toEqual(['Hello there.', 'Next.'])
  expect(out[0].startMs).toBe(6000)
  expect(out[1].startMs).toBe(9000)
})
