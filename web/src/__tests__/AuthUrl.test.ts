import { describe, it, expect } from 'vitest'
import { buildAuthUrl } from '../auth/pkce'

describe('buildAuthUrl', () => {
  it('requests offline access so Google issues a refresh token', () => {
    const params = new URL(buildAuthUrl('client-123', 'https://app.example.com', 'challenge', 'state-xyz')).searchParams

    expect(params.get('access_type')).toBe('offline')
    expect(params.get('client_id')).toBe('client-123')
    expect(params.get('response_type')).toBe('code')
    expect(params.get('code_challenge_method')).toBe('S256')
  })

  it('never sends prompt=consent — first auth consents once via Google, later sign-ins are silent (30-B)', () => {
    const params = new URL(buildAuthUrl('c', 'https://app.example.com', 'ch', 's')).searchParams

    expect(params.has('prompt')).toBe(false)
    // Still offline so an existing grant returns a session (refresh token restored by 30-A).
    expect(params.get('access_type')).toBe('offline')
  })
})
