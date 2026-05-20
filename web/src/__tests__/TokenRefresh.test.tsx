import { render, screen, act, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '../test/setup'
import { AuthProvider } from '../auth/AuthContext'
import { clearToken, setToken } from '../auth/tokenStore'
import SessionExpiredBanner from '../components/SessionExpiredBanner'
import App from '../App'
import * as silentRefreshMod from '../auth/silentRefresh'

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
      http.get('/api/notes/cards', () => new HttpResponse(null, { status: 401 })),
    )
    setToken('test-token') // ensure the 401 guard in api.ts fires

    render(<AuthProvider initialToken="test-token"><App /></AuthProvider>)

    expect(await screen.findByRole('button', { name: /sign in again/i })).toBeInTheDocument()
    expect(screen.queryByTestId('sidebar-toggle')).not.toBeInTheDocument()
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

// ─── SessionExpiredBanner component (no fake timers) ──────────────────────────

describe('SessionExpiredBanner component', () => {
  it('"Sign in again" button calls onSignIn', async () => {
    const onSignIn = vi.fn()
    render(<SessionExpiredBanner onSignIn={onSignIn} />)
    await userEvent.click(screen.getByRole('button', { name: /sign in again/i }))
    expect(onSignIn).toHaveBeenCalledOnce()
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
