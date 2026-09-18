import { test, expect } from '@playwright/test'
import { shouldOpenExternally } from '../src/externalLink'

// CHANGE-43 — the build stamp is a link to the pipeline run. In the desktop shell a new window is
// denied, so the link has to reach the system browser instead — and only for this repo's pages.

test("this repo's pipeline run opens in the browser", () => {
  expect(shouldOpenExternally('https://github.com/simonkirkham/ai-note-taker/actions/runs/35120085890')).toBe(true)
})

test('another repo does not', () => {
  expect(shouldOpenExternally('https://github.com/someone-else/other/actions/runs/1')).toBe(false)
})

test('a lookalike host does not', () => {
  expect(shouldOpenExternally('https://github.com.evil.test/simonkirkham/ai-note-taker/actions/runs/1')).toBe(false)
})

test('plain http does not', () => {
  expect(shouldOpenExternally('http://github.com/simonkirkham/ai-note-taker/actions/runs/1')).toBe(false)
})

test('a path outside the repo does not', () => {
  expect(shouldOpenExternally('https://github.com/simonkirkham/ai-note-taker-private/settings')).toBe(false)
})

test('a non-URL does not', () => {
  expect(shouldOpenExternally('javascript:alert(1)')).toBe(false)
  expect(shouldOpenExternally('not a url')).toBe(false)
})
