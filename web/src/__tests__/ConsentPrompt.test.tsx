import userEvent from '@testing-library/user-event'
import App from '../App'
import { AuthProvider } from '../auth/AuthContext'
import * as pkce from '../auth/pkce'
import * as silentRefreshMod from '../auth/silentRefresh'
import {
  clearRefreshEstablished,
  clearToken,
  isRefreshEstablished,
  markRefreshEstablished,
} from '../auth/tokenStore'
import { render, screen, act, waitFor } from '../test/render'

// Wrap buildAuthUrl so signIn's choice of forceConsent is observable. Stub the PKCE crypto
// helpers too — generateCodeChallenge uses crypto.subtle, which is unreliable under jsdom, and
// would otherwise reject before signIn reaches buildAuthUrl.
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
  clearRefreshEstablished()
  vi.mocked(silentRefreshMod.attemptSilentRefresh).mockResolvedValue(null)
  vi.mocked(pkce.buildAuthUrl).mockClear()
  vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'test-client-id')
})
afterEach(() => {
  clearToken()
  clearRefreshEstablished()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('refresh-established flag helpers', () => {
  it('defaults to false, set by mark, cleared by clear', () => {
    expect(isRefreshEstablished()).toBe(false)
    markRefreshEstablished()
    expect(isRefreshEstablished()).toBe(true)
    clearRefreshEstablished()
    expect(isRefreshEstablished()).toBe(false)
  })
})

describe('signIn consent prompt selection (BUG-16)', () => {
  it('omits prompt=consent for a returning user (flag set) — no consent grant, no email', async () => {
    markRefreshEstablished()
    render(<AuthProvider initialToken={makeToken(65)}><App /></AuthProvider>)

    // Sign out keeps the rt cookie (and the flag) — the returning-user interactive path.
    await userEvent.click(screen.getByRole('button', { name: /sign out/i }))
    await userEvent.click(screen.getByRole('button', { name: /sign in with google/i }))

    await waitFor(() => expect(pkce.buildAuthUrl).toHaveBeenCalled())
    const forceConsent = vi.mocked(pkce.buildAuthUrl).mock.calls.at(-1)![4]
    expect(forceConsent).toBe(false)
  })

  it('forces prompt=consent when no refresh token is on file (flag absent)', async () => {
    render(<AuthProvider><App /></AuthProvider>)

    await userEvent.click(await screen.findByRole('button', { name: /sign in with google/i }))

    await waitFor(() => expect(pkce.buildAuthUrl).toHaveBeenCalled())
    const forceConsent = vi.mocked(pkce.buildAuthUrl).mock.calls.at(-1)![4]
    expect(forceConsent).toBe(true)
  })
})

describe('refresh-established flag lifecycle (BUG-16)', () => {
  it('is set after a successful cold-start silent refresh', async () => {
    vi.mocked(silentRefreshMod.attemptSilentRefresh).mockResolvedValue(makeToken(65))
    render(<AuthProvider><App /></AuthProvider>)

    await screen.findByTestId('sidebar-toggle')
    expect(isRefreshEstablished()).toBe(true)
  })

  it('is cleared when a scheduled silent refresh fails', async () => {
    vi.useFakeTimers()
    try {
      markRefreshEstablished()
      vi.mocked(silentRefreshMod.attemptSilentRefresh).mockResolvedValue(null)
      render(<AuthProvider initialToken={makeToken(65)}><App /></AuthProvider>)

      await act(() => vi.advanceTimersByTimeAsync(60 * 60 * 1000))

      expect(isRefreshEstablished()).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('is cleared when the cold-start silent refresh fails (genuine sign-out → re-consent next time)', async () => {
    markRefreshEstablished()
    vi.mocked(silentRefreshMod.attemptSilentRefresh).mockResolvedValue(null)
    render(<AuthProvider><App /></AuthProvider>)

    await screen.findByRole('button', { name: /sign in with google/i })
    expect(isRefreshEstablished()).toBe(false)
  })
})
