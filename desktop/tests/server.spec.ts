import { test, expect } from '@playwright/test'
import http from 'node:http'
import path from 'node:path'
import { createBundleServer } from '../src/server'

// Headless coverage of the risky part of 31-A (the loopback server + /api proxy).
// Runs anywhere — no Electron, no display. The Electron GUI assertions live in
// shell.e2e.ts (needs a display + GUI libs; runs on Windows / CI with xvfb).

const webDist = path.resolve(__dirname, '..', 'web-dist')

function listen(server: http.Server): Promise<number> {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve((server.address() as { port: number }).port)))
}

test('serves the bundled SPA shell from local assets at /', async () => {
  const server = createBundleServer('http://127.0.0.1:1', webDist)
  const port = await listen(server)
  try {
    const res = await fetch(`http://127.0.0.1:${port}/`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/html')
    expect(await res.text()).toContain('<div id="root">')
  } finally {
    server.close()
  }
})

test('SPA fallback: unknown route serves index.html, real asset serves itself', async () => {
  const server = createBundleServer('http://127.0.0.1:1', webDist)
  const port = await listen(server)
  try {
    const route = await fetch(`http://127.0.0.1:${port}/notes/some-id`)
    expect(route.status).toBe(200)
    expect(route.headers.get('content-type')).toContain('text/html')

    const asset = await fetch(`http://127.0.0.1:${port}/favicon.svg`)
    expect(asset.status).toBe(200)
    expect(asset.headers.get('content-type')).toContain('image/svg')
  } finally {
    server.close()
  }
})

test('proxies /api to prod: forwards Authorization, strips cookie Domain for localhost', async () => {
  let seenAuth: string | undefined
  let seenPath: string | undefined
  const upstream = http.createServer((req, res) => {
    seenAuth = req.headers['authorization'] as string | undefined
    seenPath = req.url
    res.setHeader('Set-Cookie', 'rt=abc123; Domain=note-taker-ai.com; Path=/; Secure; HttpOnly; SameSite=Lax')
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ ok: true }))
  })
  const upstreamPort = await listen(upstream)

  const server = createBundleServer(`http://127.0.0.1:${upstreamPort}`, webDist)
  const port = await listen(server)
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/notes`, {
      headers: { authorization: 'Bearer test-id-token' },
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })

    // Authorization + path forwarded verbatim to the upstream.
    expect(seenAuth).toBe('Bearer test-id-token')
    expect(seenPath).toBe('/api/notes')

    // Set-Cookie relayed but Domain stripped so it is host-only for localhost.
    const setCookie = res.headers.getSetCookie().join('\n')
    expect(setCookie).toContain('rt=abc123')
    expect(setCookie).not.toContain('Domain=')
    expect(setCookie).toContain('HttpOnly')
  } finally {
    server.close()
    upstream.close()
  }
})
