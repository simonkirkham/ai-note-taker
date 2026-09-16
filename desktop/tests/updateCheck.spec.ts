import { test, expect } from '@playwright/test'
import { fetchHistory, parseHistory, HISTORY_URL } from '../src/updateCheck'

// 53-A — the main-process half of the update notice: fetch the published update history and
// hand the renderer either a clean list or null. Any failure must be null, never a throw, so the
// notice simply stays hidden.

const good = [
  { sha: 'aaa', builtAt: '2026-09-10T12:00:00.000Z', buildNumber: '780' },
  { sha: 'bbb', builtAt: '2026-09-12T12:00:00.000Z' },
]

test('parses a well-formed history, keeping only sha and builtAt', () => {
  expect(parseHistory(JSON.stringify(good))).toEqual([
    { sha: 'aaa', builtAt: '2026-09-10T12:00:00.000Z' },
    { sha: 'bbb', builtAt: '2026-09-12T12:00:00.000Z' },
  ])
})

test('malformed JSON is null', () => {
  expect(parseHistory('<html>not found</html>')).toBeNull()
})

test('a non-array is null', () => {
  expect(parseHistory('{"sha":"a"}')).toBeNull()
})

test('entries missing a string sha or builtAt are dropped', () => {
  const text = JSON.stringify([{ sha: 'a' }, { builtAt: 5, sha: 'b' }, null, good[0]])
  expect(parseHistory(text)).toEqual([{ sha: 'aaa', builtAt: '2026-09-10T12:00:00.000Z' }])
})

test('fetches the published history from the rolling release, with a time limit', async () => {
  const calls: string[] = []
  const result = await fetchHistory(async (url, init) => {
    expect(init?.signal).toBeInstanceOf(AbortSignal)
    calls.push(url)
    return new Response(JSON.stringify(good), { status: 200 })
  })
  expect(calls).toEqual([HISTORY_URL])
  expect(HISTORY_URL).toBe(
    'https://github.com/simonkirkham/ai-note-taker/releases/download/desktop-latest/releases.json',
  )
  expect(result).toHaveLength(2)
})

test('a non-OK response is null and says why', async () => {
  const warnings: string[] = []
  const result = await fetchHistory(async () => new Response('nope', { status: 404 }), (m) => warnings.push(m))
  expect(result).toBeNull()
  expect(warnings.join('\n')).toContain('404')
})

test('a network failure is null and says why', async () => {
  const warnings: string[] = []
  const result = await fetchHistory(
    async () => {
      throw new Error('getaddrinfo ENOTFOUND github.com')
    },
    (m) => warnings.push(m),
  )
  expect(result).toBeNull()
  expect(warnings.join('\n')).toContain('ENOTFOUND')
})

test('an unreadable body is null and says why', async () => {
  const warnings: string[] = []
  const result = await fetchHistory(async () => new Response('garbage', { status: 200 }), (m) => warnings.push(m))
  expect(result).toBeNull()
  expect(warnings.join('\n')).toMatch(/unreadable/i)
})
