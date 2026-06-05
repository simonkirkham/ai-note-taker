import { describe, it, expect } from 'vitest'
import { buildAuthUrl } from '../auth/pkce'

describe('buildAuthUrl', () => {
  it('requests offline access so Google issues a refresh token', () => {
    const url = buildAuthUrl('client-123', 'https://app.example.com', 'challenge', 'state-xyz')
    const params = new URL(url).searchParams

    expect(params.get('access_type')).toBe('offline')
    expect(params.get('client_id')).toBe('client-123')
    expect(params.get('response_type')).toBe('code')
    expect(params.get('code_challenge_method')).toBe('S256')
  })
})
