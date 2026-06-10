import { describe, it, expect } from 'vitest'
import { buildAuthUrl } from '../auth/pkce'

describe('buildAuthUrl', () => {
  it('requests offline access so Google issues a refresh token', () => {
    const url = buildAuthUrl('client-123', 'https://app.example.com', 'challenge', 'state-xyz', true)
    const params = new URL(url).searchParams

    expect(params.get('access_type')).toBe('offline')
    expect(params.get('client_id')).toBe('client-123')
    expect(params.get('response_type')).toBe('code')
    expect(params.get('code_challenge_method')).toBe('S256')
  })

  it('forces consent (prompt=consent) on first authorisation so Google returns a refresh token', () => {
    const params = new URL(buildAuthUrl('c', 'https://app.example.com', 'ch', 's', true)).searchParams
    expect(params.get('prompt')).toBe('consent')
    expect(params.get('access_type')).toBe('offline')
  })

  it('omits prompt for a returning user so Google re-authenticates silently (no consent grant, no email)', () => {
    const params = new URL(buildAuthUrl('c', 'https://app.example.com', 'ch', 's', false)).searchParams
    expect(params.has('prompt')).toBe(false)
    // Still offline so the existing session is returned.
    expect(params.get('access_type')).toBe('offline')
  })
})
