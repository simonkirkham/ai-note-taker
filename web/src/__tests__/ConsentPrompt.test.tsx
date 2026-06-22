import userEvent from '@testing-library/user-event'
import App from '../App'
import { AuthProvider } from '../auth/AuthContext'
import * as pkce from '../auth/pkce'
import * as silentRefreshMod from '../auth/silentRefresh'
import { clearToken } from '../auth/tokenStore'
import { render, screen, waitFor } from '../test/render'

// Wrap buildAuthUrl so the URL signIn navigates to is observable. Stub the PKCE crypto helpers
// too — generateCodeChallenge uses crypto.subtle, which is unreliable under jsdom and would
// otherwise reject before signIn reaches buildAuthUrl.
vi.mock('../auth/pkce', async (importActual) => {
  const actual = await importActual<typeof import('../auth/pkce')>()
  return {
    ...actual,
    generateCodeVerifier: vi.fn(() => 'test-verifier'),
    generateCodeChallenge: vi.fn(async () => 'test-challenge'),
    buildAuthUrl: vi.fn(actual.buildAuthUrl),
  }
})
vi.mock('../auth/silentRefresh', () => ({ attemptSilentRefresh: vi.fn() }))

function makeToken(expOffsetMinutes: number): string {
  const exp = Math.floor(Date.now() / 1000) + expOffsetMinutes * 60
  const header = btoa(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const payload = btoa(JSON.stringify({ sub: 'user-1', exp }))
  return `${header}.${payload}.fake-sig`
}

beforeEach(() => {
  clearToken()
  vi.mocked(silentRefreshMod.attemptSilentRefresh).mockResolvedValue(null)
  vi.mocked(pkce.buildAuthUrl).mockClear()
  vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'test-client-id')
})
afterEach(() => {
  clearToken()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

// 30-B: signIn never sends prompt=consent. The first-ever authorization still consents once
// (Google forces it on a not-yet-granted scope); every sign-in after that re-authenticates
// silently. Lost refresh tokens are restored from the server-side store (30-A), not by
// re-forcing consent — so the consent screen and its email never reappear on return.
describe('signIn never forces consent (30-B)', () => {
  it('omits prompt=consent on a first-time sign-in (no prior session on this device)', async () => {
    // Cold start: no persisted token, refresh cookie dead → the sign-in screen shows.
    render(<AuthProvider><App /></AuthProvider>)

    await userEvent.click(await screen.findByRole('button', { name: /sign in with google/i }))

    await waitFor(() => expect(pkce.buildAuthUrl).toHaveBeenCalled())
    const url = vi.mocked(pkce.buildAuthUrl).mock.results.at(-1)!.value as string
    expect(url).not.toContain('prompt=')
  })

  it('omits prompt=consent on a returning sign-in (after sign-out)', async () => {
    render(<AuthProvider initialToken={makeToken(65)}><App /></AuthProvider>)

    await userEvent.click(screen.getByRole('button', { name: /sign out/i }))
    await userEvent.click(screen.getByRole('button', { name: /sign in with google/i }))

    await waitFor(() => expect(pkce.buildAuthUrl).toHaveBeenCalled())
    const url = vi.mocked(pkce.buildAuthUrl).mock.results.at(-1)!.value as string
    expect(url).not.toContain('prompt=')
  })
})
