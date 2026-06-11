import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import App from '../App'
import { AuthProvider } from '../auth/AuthContext'
import * as silentRefreshMod from '../auth/silentRefresh'
import { clearToken, setToken } from '../auth/tokenStore'
import SessionExpiredBanner from '../components/SessionExpiredBanner'
import { render, screen, act, fireEvent } from '../test/render'
import { server } from '../test/setup'

vi.mock('../auth/silentRefresh', () => ({
  attemptSilentRefresh: vi.fn(),
}))

// Creates a well-formed JWT stub with exp = now + offsetMinutes * 60 seconds.
// With fake timers, Date.now() reflects the advanced time.
function makeToken(expOffsetMinutes: number): string {
  const exp = Math.floor(Date.now() / 1000) + expOffsetMinutes * 60
  const header = btoa(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const payload = btoa(JSON.stringify({ sub: 'user-1', exp }))
  return `${header}.${payload}.fake-sig`
}

beforeEach(() => {
  clearToken()
  // Vitest 4: restoreAllMocks() only restores vi.spyOn spies, not the call history of a
  // vi.fn() created inside a vi.mock factory (attemptSilentRefresh). Without an explicit
  // clear its call count accumulates across tests (a test expecting 0 sees 8+). Clear all
  // mock history here, then re-establish this test's default resolution below.
  vi.clearAllMocks()
  vi.mocked(silentRefreshMod.attemptSilentRefresh).mockResolvedValue(null)
})

afterEach(() => {
  clearToken()
  vi.restoreAllMocks()
})

// ─── Timer-based tests use fake timers ────────────────────────────────────────

describe('timer scheduling on sign-in', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'test-client-id')
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
  })

  it('schedules silent refresh 5 minutes before token expiry', async () => {
    const token = makeToken(65) // expires in 65 min → refresh fires at 60 min
    render(<AuthProvider initialToken={token}><App /></AuthProvider>)

    // 1 second before the 60-minute mark — should not have fired yet
    await act(() => vi.advanceTimersByTimeAsync(59 * 60 * 1000 + 59_000))
    expect(silentRefreshMod.attemptSilentRefresh).not.toHaveBeenCalled()

    // Cross the 60-minute mark
    await act(() => vi.advanceTimersByTimeAsync(1_000))
    expect(silentRefreshMod.attemptSilentRefresh).toHaveBeenCalledOnce()
  })
})

describe('silent refresh success', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'test-client-id')
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
  })

  it('replaces the token silently and keeps the session active', async () => {
    // mockImplementation so the token is created at call time (with the advanced fake clock)
    vi.mocked(silentRefreshMod.attemptSilentRefresh).mockImplementation(async () => makeToken(65))

    const token = makeToken(65)
    render(<AuthProvider initialToken={token}><App /></AuthProvider>)

    await act(() => vi.advanceTimersByTimeAsync(60 * 60 * 1000))

    expect(screen.queryByRole('button', { name: /sign in again/i })).not.toBeInTheDocument()
    expect(screen.getByTestId('sidebar-toggle')).toBeInTheDocument()
  })

  it('reschedules refresh based on the new token expiry', async () => {
    // Each call creates a token 65 min ahead from the current (fake) clock
    vi.mocked(silentRefreshMod.attemptSilentRefresh)
      .mockImplementationOnce(async () => makeToken(65)) // first refresh succeeds
      .mockResolvedValue(null)                           // second refresh fails → banner

    const token = makeToken(65)
    render(<AuthProvider initialToken={token}><App /></AuthProvider>)

    // First refresh fires at 60 min
    await act(() => vi.advanceTimersByTimeAsync(60 * 60 * 1000))
    expect(silentRefreshMod.attemptSilentRefresh).toHaveBeenCalledTimes(1)

    // Second refresh fires 60 min later (new token also expires in 65 min from this point)
    await act(() => vi.advanceTimersByTimeAsync(60 * 60 * 1000))
    expect(silentRefreshMod.attemptSilentRefresh).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('button', { name: /sign in again/i })).toBeInTheDocument()
  })
})

describe('silent refresh failure', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'test-client-id')
    vi.mocked(silentRefreshMod.attemptSilentRefresh).mockResolvedValue(null)
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
  })

  it('shows the session-expired banner when silent refresh returns null', async () => {
    const token = makeToken(65)
    render(<AuthProvider initialToken={token}><App /></AuthProvider>)

    await act(() => vi.advanceTimersByTimeAsync(60 * 60 * 1000))

    // Use synchronous getByRole after act() — state is already flushed
    expect(screen.getByRole('button', { name: /sign in again/i })).toBeInTheDocument()
    expect(screen.queryByTestId('sidebar-toggle')).not.toBeInTheDocument()
  })
})

// ─── 401 response — no fake timers (MSW is async) ─────────────────────────────

describe('401 response', () => {
  beforeEach(() => vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'test-client-id'))
  afterEach(() => vi.unstubAllEnvs())

  it('shows the session-expired banner when the API returns 401', async () => {
    server.use(
      http.get('/api/w/:wsId/notes/cards', () => new HttpResponse(null, { status: 401 })),
    )
    setToken('test-token') // ensure the 401 guard in api.ts fires

    render(<AuthProvider initialToken="test-token"><App /></AuthProvider>)

    expect(await screen.findByRole('button', { name: /sign in again/i })).toBeInTheDocument()
    expect(screen.queryByTestId('sidebar-toggle')).not.toBeInTheDocument()
  })
})

// ─── Cold-load token seeding (BUG-1) — no fake timers (MSW is async) ──────────

describe('cold load token seeding', () => {
  beforeEach(() => vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'test-client-id'))
  afterEach(() => {
    vi.unstubAllEnvs()
    localStorage.removeItem('id_token')
  })

  it('attaches the persisted token to the first data fetch on cold load', async () => {
    // BUG-1: the persisted token was only seeded into the in-memory store in a parent
    // effect, which runs AFTER child data-fetch effects — so the first fetches went out
    // with no Authorization header, got 401, and left a blank screen. The token must be
    // seeded synchronously so the very first request carries it.
    const token = makeToken(65)
    localStorage.setItem('id_token', token)

    let captured = false
    let firstAuth: string | null = null
    server.use(
      http.get('/api/w/:wsId/notes/cards', ({ request }) => {
        if (!captured) {
          captured = true
          firstAuth = request.headers.get('authorization')
        }
        return HttpResponse.json({ cards: [] })
      }),
    )

    // No initialToken — exercise the real persisted-token cold-load path.
    render(<AuthProvider><App /></AuthProvider>)

    await screen.findByTestId('sidebar-toggle')
    expect(firstAuth).toBe(`Bearer ${token}`)
  })
})

// ─── Cold-start silent refresh (BUG-15) — no fake timers (refresh is async) ───

describe('cold-start silent refresh (BUG-15)', () => {
  beforeEach(() => vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'test-client-id'))
  afterEach(() => {
    vi.unstubAllEnvs()
    localStorage.removeItem('id_token')
  })

  it('restores the session from the refresh cookie when there is no persisted token', async () => {
    // No persisted id_token (expired and discarded), but the httpOnly rt cookie would
    // still mint a fresh one. Bootstrap must use it instead of forcing a full sign-in.
    vi.mocked(silentRefreshMod.attemptSilentRefresh).mockResolvedValue(makeToken(65))

    render(<AuthProvider><App /></AuthProvider>)

    expect(await screen.findByTestId('sidebar-toggle')).toBeInTheDocument()
    expect(silentRefreshMod.attemptSilentRefresh).toHaveBeenCalledOnce()
    expect(screen.queryByRole('button', { name: /sign in with google/i })).not.toBeInTheDocument()
  })

  it('does not flash the sign-in screen while the cold-start refresh is in flight', async () => {
    let resolveRefresh: (t: string | null) => void = () => {}
    vi.mocked(silentRefreshMod.attemptSilentRefresh).mockImplementation(
      () => new Promise<string | null>((res) => { resolveRefresh = res }),
    )

    render(<AuthProvider><App /></AuthProvider>)

    // While the refresh promise is pending, neither the sign-in screen nor the app shows.
    expect(screen.queryByRole('button', { name: /sign in with google/i })).not.toBeInTheDocument()
    expect(screen.queryByTestId('sidebar-toggle')).not.toBeInTheDocument()

    await act(async () => { resolveRefresh(makeToken(65)) })
    expect(await screen.findByTestId('sidebar-toggle')).toBeInTheDocument()
  })

  it('falls back to the sign-in screen when the refresh cookie is gone', async () => {
    vi.mocked(silentRefreshMod.attemptSilentRefresh).mockResolvedValue(null)

    render(<AuthProvider><App /></AuthProvider>)

    expect(await screen.findByRole('button', { name: /sign in with google/i })).toBeInTheDocument()
    expect(silentRefreshMod.attemptSilentRefresh).toHaveBeenCalledOnce()
    expect(screen.queryByTestId('sidebar-toggle')).not.toBeInTheDocument()
  })

  it('uses a valid persisted token directly and skips the cold-start refresh', async () => {
    const token = makeToken(65)
    localStorage.setItem('id_token', token)
    vi.mocked(silentRefreshMod.attemptSilentRefresh).mockResolvedValue(makeToken(65))

    render(<AuthProvider><App /></AuthProvider>)

    expect(await screen.findByTestId('sidebar-toggle')).toBeInTheDocument()
    expect(silentRefreshMod.attemptSilentRefresh).not.toHaveBeenCalled()
  })
})

// ─── Banner UI ────────────────────────────────────────────────────────────────

describe('session-expired banner', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'test-client-id')
    vi.mocked(silentRefreshMod.attemptSilentRefresh).mockResolvedValue(null)
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
  })

  async function renderWithExpiredSession() {
    const token = makeToken(65)
    render(<AuthProvider initialToken={token}><App /></AuthProvider>)
    await act(() => vi.advanceTimersByTimeAsync(60 * 60 * 1000))
    return screen.getByRole('button', { name: /sign in again/i })
  }

  it('shows a "Sign in again" button', async () => {
    const btn = await renderWithExpiredSession()
    expect(btn).toBeInTheDocument()
  })

  it('is non-dismissable — no close or dismiss button', async () => {
    await renderWithExpiredSession()
    expect(screen.queryByRole('button', { name: /close|dismiss|cancel/i })).not.toBeInTheDocument()
  })
})

// ─── Tab visibility change ────────────────────────────────────────────────────

describe('tab visibility change', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'test-client-id')
    vi.mocked(silentRefreshMod.attemptSilentRefresh).mockResolvedValue(null)
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true, writable: true })
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
  })

  function fireVisibilityChange() {
    document.dispatchEvent(new Event('visibilitychange'))
  }

  it('shows banner when tab wakes with an expired token (timer was throttled)', async () => {
    const token = makeToken(65)
    render(<AuthProvider initialToken={token}><App /></AuthProvider>)

    // Advance system clock past expiry WITHOUT firing timers (simulates background throttling)
    vi.setSystemTime(new Date(Date.now() + 66 * 60 * 1000))

    await act(async () => { fireVisibilityChange() })

    expect(screen.getByRole('button', { name: /sign in again/i })).toBeInTheDocument()
    expect(silentRefreshMod.attemptSilentRefresh).not.toHaveBeenCalled()
  })

  it('attempts immediate refresh when tab wakes with token near expiry', async () => {
    vi.mocked(silentRefreshMod.attemptSilentRefresh).mockResolvedValue(null)
    const token = makeToken(10) // expires in 10 min → timer set for 5 min
    render(<AuthProvider initialToken={token}><App /></AuthProvider>)

    // Advance clock 6 min without firing timers — now 4 min remain (< 5 min lead)
    vi.setSystemTime(new Date(Date.now() + 6 * 60 * 1000))

    await act(async () => { fireVisibilityChange() })

    expect(silentRefreshMod.attemptSilentRefresh).toHaveBeenCalledOnce()
  })

  it('does nothing when tab wakes with a token that has no exp claim', async () => {
    // A token without exp (e.g. a service account token) should not trigger refresh or banner
    const header = btoa(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
    const payload = btoa(JSON.stringify({ sub: 'user-1' })) // no exp
    const noExpToken = `${header}.${payload}.fake-sig`
    render(<AuthProvider initialToken={noExpToken}><App /></AuthProvider>)

    await act(async () => { fireVisibilityChange() })

    expect(silentRefreshMod.attemptSilentRefresh).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: /sign in again/i })).not.toBeInTheDocument()
  })

  it('does nothing when tab wakes with a token with plenty of time remaining', async () => {
    const token = makeToken(60) // expires in 60 min — well outside the 5-min window
    render(<AuthProvider initialToken={token}><App /></AuthProvider>)

    await act(async () => { fireVisibilityChange() })

    expect(silentRefreshMod.attemptSilentRefresh).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: /sign in again/i })).not.toBeInTheDocument()
  })
})

// ─── Pre-flight expiry guard in apiFetch ──────────────────────────────────────

describe('pre-flight expiry guard in apiFetch', () => {
  beforeEach(() => vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'test-client-id'))
  afterEach(() => vi.unstubAllEnvs())

  it('shows banner and does not call fetch when token is expired mid-session', async () => {
    // Render with a valid token to let AuthProvider set up its callbacks
    const validToken = makeToken(65)
    render(<AuthProvider initialToken={validToken}><App /></AuthProvider>)
    await screen.findByTestId('sidebar-toggle')

    // Replace with an expired token (simulates expiry during an active session)
    const expiredToken = makeToken(-5)
    setToken(expiredToken)

    const fetchSpy = vi.spyOn(window, 'fetch')

    // Trigger an action that causes an API call (clicking New Note calls POST /notes)
    await act(async () => {
      screen.getByTestId('new-note-button').click()
    })

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /sign in again/i })).toBeInTheDocument()
  })
})

// ─── SessionExpiredBanner component (no fake timers) ──────────────────────────

describe('SessionExpiredBanner component', () => {
  it('"Sign in again" button calls onSignIn', async () => {
    const onSignIn = vi.fn()
    render(<SessionExpiredBanner onSignIn={onSignIn} />)
    await userEvent.click(screen.getByRole('button', { name: /sign in again/i }))
    expect(onSignIn).toHaveBeenCalledOnce()
  })

  it('moves focus into the dialog on open', () => {
    render(<SessionExpiredBanner onSignIn={vi.fn()} />)
    const dialog = screen.getByRole('dialog')
    expect(dialog.contains(document.activeElement)).toBe(true)
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /sign in again/i }))
  })

  it('Tab and Shift+Tab keep focus on the sole control', async () => {
    render(<SessionExpiredBanner onSignIn={vi.fn()} />)
    const signIn = screen.getByRole('button', { name: /sign in again/i })
    expect(document.activeElement).toBe(signIn)
    await userEvent.tab()
    expect(document.activeElement).toBe(signIn)
    await userEvent.tab({ shift: true })
    expect(document.activeElement).toBe(signIn)
  })
})

// ─── Sign-out clears the refresh timer ────────────────────────────────────────

describe('sign-out', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'test-client-id')
    vi.mocked(silentRefreshMod.attemptSilentRefresh).mockResolvedValue(null)
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
  })

  it('clears the refresh timer so attemptSilentRefresh is never called after sign-out', async () => {
    const token = makeToken(65)
    render(<AuthProvider initialToken={token}><App /></AuthProvider>)

    // Sign out before the timer fires (synchronous fireEvent avoids userEvent's async internals)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /sign out/i }))
    })

    // Advance past the 60-min refresh point
    await act(() => vi.advanceTimersByTimeAsync(60 * 60 * 1000))

    expect(silentRefreshMod.attemptSilentRefresh).not.toHaveBeenCalled()
  })
})
