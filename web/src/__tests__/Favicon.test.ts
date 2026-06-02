// @vitest-environment node
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

// BUG-2: the browser issues a default GET /favicon.ico on every page load and
// gets a 404 (no icon is configured), logging a failed request. Declaring an
// explicit <link rel="icon"> suppresses the default request; the referenced
// asset must exist so it actually resolves.
//
// This is a pure filesystem assertion, so it runs in the node environment
// (not jsdom): vitest's cwd is the web/ project root.

const indexHtmlPath = resolve(process.cwd(), 'index.html')
const publicDir = resolve(process.cwd(), 'public')

describe('favicon (BUG-2)', () => {
  const html = readFileSync(indexHtmlPath, 'utf8')

  it('declares an explicit icon link so the browser does not fall back to /favicon.ico', () => {
    const iconLink = html.match(/<link[^>]*rel=["']icon["'][^>]*>/i)
    expect(iconLink).not.toBeNull()
  })

  it('points the icon link at an asset that exists in public/', () => {
    const hrefMatch = html.match(/<link[^>]*rel=["']icon["'][^>]*href=["']([^"']+)["']/i)
    expect(hrefMatch).not.toBeNull()
    const href = hrefMatch![1]
    // Root-absolute href like /favicon.svg maps to web/public/favicon.svg in Vite.
    const assetPath = resolve(publicDir, href.replace(/^\//, ''))
    expect(existsSync(assetPath)).toBe(true)
  })
})
