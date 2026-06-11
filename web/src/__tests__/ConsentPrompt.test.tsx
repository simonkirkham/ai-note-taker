import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import App from '../App'
import { AuthProvider } from '../auth/AuthContext'
import * as pkce from '../auth/pkce'
import * as silentRefreshMod from '../auth/silentRefresh'
import {
  clearRefreshEstablished,
  clearToken,
  isRefreshEstablished,
  markRefreshEstablished,
  setToken,
} from '../auth/tokenStore'
import { render, screen, act, waitFor } from '../test/render'
import { server } from '../test/setup'

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
    // The real URL signIn navigated to omits prompt entirely (asserting the built result, not
    // just the arg, catches a regression where signIn computes the flag but never navigates).
    const url = vi.mocked(pkce.buildAuthUrl).mock.results.at(-1)!.value as string
    expect(url).not.toContain('prompt=')
  })

  it('forces prompt=consent when no refresh token is on file (flag absent)', async () => {
    render(<AuthProvider><App /></AuthProvider>)

    await userEvent.click(await screen.findByRole('button', { name: /sign in with google/i }))

    await waitFor(() => expect(pkce.buildAuthUrl).toHaveBeenCalled())
    const forceConsent = vi.mocked(pkce.buildAuthUrl).mock.calls.at(-1)![4]
    expect(forceConsent).toBe(true)
    const url = vi.mocked(pkce.buildAuthUrl).mock.results.at(-1)!.value as string
    expect(url).toContain('prompt=consent')
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

  it('is cleared on the 401-driven refresh failure (the path that does not go through handleRefreshFailure)', async () => {
    // A fetch-driven 401 races ahead of the scheduled/visibility timers: apiFetch asks for a
    // one-shot silent refresh, which fails → the flag must clear so the next sign-in re-consents
    // and obtains a fresh refresh token (otherwise the session loops at ~1h).
    markRefreshEstablished()
    vi.mocked(silentRefreshMod.attemptSilentRefresh).mockResolvedValue(null)
    server.use(http.get('/api/w/:wsId/notes/cards', () => new HttpResponse(null, { status: 401 })))
    setToken('test-token')

    render(<AuthProvider initialToken="test-token"><App /></AuthProvider>)

    await screen.findByRole('button', { name: /sign in again/i })
    expect(isRefreshEstablished()).toBe(false)
  })
})
