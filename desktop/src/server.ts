import http from 'node:http'
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'

// Loopback bundle server: serves the compiled web/ frontend and proxies /api/*
// to the prod origin. Kept free of any electron import so it is testable headlessly.

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}

// Drop Domain so the cookie is host-only for localhost; keep Secure (localhost is
// a secure context) and HttpOnly so rt is never readable by the renderer.
export function rewriteCookieForLocalhost(setCookie: string): string {
  return setCookie.replace(/;\s*Domain=[^;]*/i, '')
}

async function proxyApi(req: http.IncomingMessage, res: http.ServerResponse, prodOrigin: string): Promise<void> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  const body = chunks.length ? Buffer.concat(chunks) : undefined

  const headers = new Headers()
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue
    const lower = key.toLowerCase()
    // Drop the localhost-revealing/hop-by-hop headers; forward Authorization + Cookie.
    if (['host', 'origin', 'referer', 'accept-encoding', 'connection', 'content-length'].includes(lower)) continue
    headers.set(key, Array.isArray(value) ? value.join(', ') : value)
  }
  // Present the prod origin upstream (mirrors the browser's same-origin request in
  // prod) so any Origin-allowlist/CSRF check on the API still passes.
  headers.set('origin', prodOrigin)

  const upstream = await fetch(`${prodOrigin}${req.url}`, {
    method: req.method,
    headers,
    body: body as BodyInit | undefined,
    redirect: 'manual',
  })

  res.statusCode = upstream.status
  upstream.headers.forEach((value, key) => {
    const lower = key.toLowerCase()
    if (['set-cookie', 'content-encoding', 'content-length', 'transfer-encoding', 'connection'].includes(lower)) return
    // Keep redirects same-origin: strip the prod origin so the client stays on localhost.
    if (lower === 'location' && value.startsWith(prodOrigin)) {
      res.setHeader(key, value.slice(prodOrigin.length) || '/')
      return
    }
    res.setHeader(key, value)
  })
  for (const cookie of upstream.headers.getSetCookie()) {
    res.appendHeader('set-cookie', rewriteCookieForLocalhost(cookie))
  }
  res.end(Buffer.from(await upstream.arrayBuffer()))
}

async function serveAsset(req: http.IncomingMessage, res: http.ServerResponse, webDist: string): Promise<void> {
  // A malformed percent-escape (e.g. /%ZZ) throws — treat as an unknown path (SPA fallback).
  let urlPath: string
  try {
    urlPath = decodeURIComponent((req.url ?? '/').split('?')[0])
  } catch {
    urlPath = '/'
  }
  // Resolve as forced-relative and confirm containment — a decoded `..%2f` must
  // never escape web-dist (path.join would normalise it away into a traversal).
  const candidate = path.resolve(webDist, '.' + urlPath)
  const inside = candidate === webDist || candidate.startsWith(webDist + path.sep)
  // SPA fallback: anything not an existing in-bundle file serves index.html.
  const file = urlPath !== '/' && inside && existsSync(candidate) && !candidate.endsWith(path.sep)
    ? candidate
    : path.join(webDist, 'index.html')
  try {
    const data = await readFile(file)
    res.setHeader('Content-Type', CONTENT_TYPES[path.extname(file)] ?? 'application/octet-stream')
    res.end(data)
  } catch {
    res.statusCode = 404
    res.end('Not found')
  }
}

export function createBundleServer(prodOrigin: string, webDist: string): http.Server {
  return http.createServer((req, res) => {
    const handler = req.url?.startsWith('/api/')
      ? proxyApi(req, res, prodOrigin)
      : serveAsset(req, res, webDist)
    handler.catch((err) => {
      console.error('[desktop] request failed:', err)
      if (!res.headersSent) res.statusCode = 500
      res.end('Internal error')
    })
  })
}

export function startBundleServer(port: number, prodOrigin: string, webDist: string): Promise<http.Server> {
  const server = createBundleServer(prodOrigin, webDist)
  server.on('error', (err) => console.error(`[desktop] server error on port ${port} (is it already in use?):`, err))
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)))
}
