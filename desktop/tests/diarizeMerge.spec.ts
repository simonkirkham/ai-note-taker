import { test, expect } from '@playwright/test'
import { mergeDiarized, turnsToText } from '../src/diarizeMerge'
import type { WhisperSegment } from '../src/whisperParse'

// 48-C — interleave source-separated (Me/Them) transcripts by time. Pure, headless.
const seg = (startMs: number, endMs: number, text: string): WhisperSegment => ({ startMs, endMs, text })

test('interleaves the two streams by start time into speaker turns', () => {
  const me = [seg(0, 2000, 'hello there'), seg(6000, 8000, 'sounds good')]
  const them = [seg(2000, 5000, 'hi how are you')]
  const turns = mergeDiarized(me, them)
  expect(turns).toEqual([
    { speaker: 'Me', text: 'hello there' },
    { speaker: 'Them', text: 'hi how are you' },
    { speaker: 'Me', text: 'sounds good' },
  ])
})

test('collapses consecutive same-speaker segments into one turn', () => {
  const me = [seg(0, 1000, 'one'), seg(1000, 2000, 'two'), seg(2000, 3000, 'three')]
  const turns = mergeDiarized(me, [])
  expect(turns).toEqual([{ speaker: 'Me', text: 'one two three' }])
})

test('empty/whitespace segments are dropped', () => {
  const me = [seg(0, 1000, '  '), seg(1000, 2000, 'real')]
  expect(mergeDiarized(me, [])).toEqual([{ speaker: 'Me', text: 'real' }])
})

test('only-me and only-them still produce a labelled transcript', () => {
  expect(mergeDiarized([seg(0, 1000, 'solo')], [])).toEqual([{ speaker: 'Me', text: 'solo' }])
  expect(mergeDiarized([], [seg(0, 1000, 'remote')])).toEqual([{ speaker: 'Them', text: 'remote' }])
})

test('turnsToText renders one Speaker: line per turn', () => {
  const turns = mergeDiarized([seg(0, 1000, 'hi')], [seg(1000, 2000, 'hello')])
  expect(turnsToText(turns)).toBe('Me: hi\nThem: hello')
})

test('two empty streams → empty transcript', () => {
  expect(mergeDiarized([], [])).toEqual([])
  expect(turnsToText([])).toBe('')
})
