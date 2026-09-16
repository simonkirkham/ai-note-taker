import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { extractRumSnippet, injectRumSnippet } from '../scripts/rumSnippet.mjs'

// TI-98 — the desktop app ships the same frontend as the website, but only the website's
// deploy put the monitoring snippet into index.html, so every desktop fault reached nothing.
// The desktop build now copies the snippet out of the live site's index.html.

const PLACEHOLDER = '<script id="rum-snippet"></script>'
const LIVE_SNIPPET = '<script id="rum-snippet">(function(n,i){window.x=1})("cwr","abc");</script>'
const liveHtml = `<html><head><script>theme()</script>${LIVE_SNIPPET}</head><body></body></html>`
const builtHtml = `<html><head><script>theme()</script>${PLACEHOLDER}</head><body></body></html>`

test('extracts the populated snippet from the live page', () => {
  expect(extractRumSnippet(liveHtml)).toBe(LIVE_SNIPPET)
})

test('finds no snippet when the live page carries only the empty placeholder', () => {
  expect(extractRumSnippet(builtHtml)).toBeNull()
})

test('finds no snippet in a page without one', () => {
  expect(extractRumSnippet('<html><head></head></html>')).toBeNull()
})

test('replaces the empty placeholder in the built page with the live snippet', () => {
  const out = injectRumSnippet(builtHtml, LIVE_SNIPPET)
  expect(out).toContain(LIVE_SNIPPET)
  expect(out).not.toContain(PLACEHOLDER)
  expect(out).toContain('<script>theme()</script>')
})

test('refuses to inject when the built page has no placeholder', () => {
  expect(() => injectRumSnippet('<html></html>', LIVE_SNIPPET)).toThrow(/placeholder/)
})

test('the source page still carries the placeholder the injection targets', () => {
  const source = readFileSync(path.resolve(__dirname, '..', '..', 'web', 'index.html'), 'utf8')
  expect(source).toContain(PLACEHOLDER)
})

test('the published installer build refuses to ship without the snippet', () => {
  const wf = readFileSync(path.resolve(__dirname, '..', '..', '.github', 'workflows', 'publish-desktop.yml'), 'utf8')
  expect(wf).toMatch(/REQUIRE_RUM_SNIPPET:\s*["']?1/)
  const build = readFileSync(path.resolve(__dirname, '..', 'scripts', 'build-web.mjs'), 'utf8')
  expect(build).toContain('REQUIRE_RUM_SNIPPET')
})
