import { test, expect } from '@playwright/test'
import { appendHistory } from '../scripts/append-history.mjs'

// 53-A — the publish step that grows the update history. Pure: previous text in, next list out.

const entry = (n: number) => ({ sha: `s${n}`, builtAt: new Date(Date.UTC(2026, 8, n)).toISOString() })

test('starts a history when there was none', () => {
  expect(appendHistory(null, entry(1))).toEqual([entry(1)])
})

test('starts over when the previous history is unreadable', () => {
  expect(appendHistory('not json', entry(1))).toEqual([entry(1)])
})

test('appends to the previous history', () => {
  expect(appendHistory(JSON.stringify([entry(1)]), entry(2))).toEqual([entry(1), entry(2)])
})

test('replaces an entry for the same commit instead of duplicating it', () => {
  const again = { ...entry(2), sha: 's1' }
  expect(appendHistory(JSON.stringify([entry(1)]), again)).toEqual([again])
})

test('keeps only the newest 50', () => {
  const previous = Array.from({ length: 50 }, (_, i) => entry(i + 1))
  const next = appendHistory(JSON.stringify(previous), { sha: 'new', builtAt: '2026-12-01T00:00:00.000Z' })
  expect(next).toHaveLength(50)
  expect(next[0]).toEqual(entry(2))
  expect(next[49].sha).toBe('new')
})
