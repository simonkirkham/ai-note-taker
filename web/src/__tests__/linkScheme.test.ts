import { describe, it, expect } from 'vitest'
import { hasDisallowedScheme } from '../lib/linkScheme'

const ALLOWED = ['http', 'https', 'mailto']

describe('hasDisallowedScheme', () => {
  it('rejects executable schemes', () => {
    expect(hasDisallowedScheme('javascript:alert(1)', ALLOWED)).toBe(true)
    expect(hasDisallowedScheme('data:text/html,<script>x</script>', ALLOWED)).toBe(true)
    expect(hasDisallowedScheme('vbscript:msgbox', ALLOWED)).toBe(true)
  })

  it('rejects a non-allowlisted scheme that Tiptap\'s default would permit (ftp/tel)', () => {
    expect(hasDisallowedScheme('ftp://example.com/x', ALLOWED)).toBe(true)
    expect(hasDisallowedScheme('tel:+1234', ALLOWED)).toBe(true)
  })

  it('rejects schemes obfuscated with leading whitespace / control chars (the bypass class)', () => {
    expect(hasDisallowedScheme('\tjavascript:alert(1)', ALLOWED)).toBe(true)
    expect(hasDisallowedScheme('  javascript:alert(1)', ALLOWED)).toBe(true)
    expect(hasDisallowedScheme('\tftp://example.com', ALLOWED)).toBe(true)
    expect(hasDisallowedScheme(' ftp://example.com', ALLOWED)).toBe(true)
    expect(hasDisallowedScheme('\x00ftp://example.com', ALLOWED)).toBe(true)
    expect(hasDisallowedScheme(' ftp://example.com', ALLOWED)).toBe(true)
  })

  it('is case-insensitive on the scheme', () => {
    expect(hasDisallowedScheme('JaVaScRiPt:alert(1)', ALLOWED)).toBe(true)
    expect(hasDisallowedScheme('FTP://x', ALLOWED)).toBe(true)
  })

  it('allows allowlisted schemes', () => {
    expect(hasDisallowedScheme('https://example.com/page', ALLOWED)).toBe(false)
    expect(hasDisallowedScheme('http://example.com', ALLOWED)).toBe(false)
    expect(hasDisallowedScheme('mailto:team@example.com', ALLOWED)).toBe(false)
  })

  it('does not flag schemeless / relative URLs (left to default validation)', () => {
    expect(hasDisallowedScheme('/relative/path', ALLOWED)).toBe(false)
    expect(hasDisallowedScheme('#anchor', ALLOWED)).toBe(false)
    expect(hasDisallowedScheme('example.com/page', ALLOWED)).toBe(false)
    expect(hasDisallowedScheme('//protocol-relative.com', ALLOWED)).toBe(false)
  })
})
