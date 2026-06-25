import { describe, expect, it } from 'vitest'
import { buildMicrosoftAuthUrl } from '../auth/pkce'

// CHANGE-26: the Outlook connect must target the `common` tenant (work/school + personal accounts,
// not personal-only `consumers`) and force the account picker so a different account can be chosen.
describe('buildMicrosoftAuthUrl', () => {
  const url = () => new URL(buildMicrosoftAuthUrl('client-1', 'https://app.example.com', 'challenge', 'state-1'))

  it('targets the common tenant (work/school + personal)', () => {
    expect(url().pathname).toBe('/common/oauth2/v2.0/authorize')
  })

  it('forces the account picker with prompt=select_account', () => {
    expect(url().searchParams.get('prompt')).toBe('select_account')
  })

  it('requests offline calendar access (refresh token) for the right client', () => {
    const p = url().searchParams
    expect(p.get('client_id')).toBe('client-1')
    expect(p.get('scope')).toContain('offline_access')
    expect(p.get('scope')).toContain('https://graph.microsoft.com/Calendars.Read')
    expect(p.get('code_challenge_method')).toBe('S256')
  })
})
