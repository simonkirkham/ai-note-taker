import { render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthProvider } from '../auth/AuthContext'
import { useAuth } from '../auth/context'
import { server } from '../test/setup'

// BUG-71: `isCalendarConnectReturn` checked only that `calendar_state` EXISTS, not that the
// returned `state` matches it. An abandoned calendar connect (started, never completed) leaves that
// marker in sessionStorage for the life of the tab. A later ORDINARY sign-in return then satisfied
// the check, seeded `authLoading = true`, and took the sign-in exchange path — which never clears
// authLoading. The gate sat on its loading state indefinitely, recoverable only by clearing site
// data, which is precisely what the affected user is least likely to try.
//
// The effect already compared the two before ACTING on the calendar branch; only the derivation
// that predicts which branch will run was weaker. Predicting the wrong branch is the whole bug.

function Probe() {
  const { idToken, authLoading } = useAuth()
  return (
    <div>
      <span data-testid="loading">{authLoading ? 'loading' : 'ready'}</span>
      <span data-testid="token">{idToken ?? 'none'}</span>
    </div>
  )
}

beforeEach(() => {
  vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'test-client-id')
  sessionStorage.clear()
  server.use(
    http.post('/api/auth/token', () => HttpResponse.json({ id_token: 'fresh-token' })),
  )
})

afterEach(() => {
  vi.unstubAllEnvs()
  sessionStorage.clear()
  window.history.replaceState({}, '', '/')
})

describe('a stale calendar_state does not strand the gate (BUG-71)', () => {
  it('completes an ordinary sign-in return when an abandoned connect left its marker behind', async () => {
    // The abandoned connect's leftovers.
    sessionStorage.setItem('calendar_state', 'state-from-an-abandoned-connect')
    sessionStorage.setItem('calendar_verifier', 'verifier-from-an-abandoned-connect')
    // A perfectly ordinary sign-in return, whose state matches the SIGN-IN markers.
    sessionStorage.setItem('pkce_code_verifier', 'signin-verifier')
    sessionStorage.setItem('pkce_state', 'signin-state')
    window.history.replaceState({}, '', '/?code=signin-code&state=signin-state')

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    )

    // Before the fix this seeded authLoading=true and nothing on the sign-in path ever cleared it.
    await waitFor(() => expect(screen.getByTestId('token')).toHaveTextContent('fresh-token'))
    expect(screen.getByTestId('loading')).toHaveTextContent('ready')
  })

  it('clears the abandoned connect markers rather than leaving them for the next return', async () => {
    sessionStorage.setItem('calendar_state', 'state-from-an-abandoned-connect')
    sessionStorage.setItem('calendar_verifier', 'verifier-from-an-abandoned-connect')
    sessionStorage.setItem('calendar_workspace', 'ws-1')
    sessionStorage.setItem('calendar_provider', 'google')
    sessionStorage.setItem('pkce_code_verifier', 'signin-verifier')
    sessionStorage.setItem('pkce_state', 'signin-state')
    window.history.replaceState({}, '', '/?code=signin-code&state=signin-state')

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    )

    await waitFor(() => expect(screen.getByTestId('token')).toHaveTextContent('fresh-token'))
    for (const key of ['calendar_state', 'calendar_verifier', 'calendar_workspace', 'calendar_provider']) {
      expect(sessionStorage.getItem(key)).toBeNull()
    }
  })

  it('still takes the calendar branch when the returned state DOES match', async () => {
    // The genuine calendar return must be unaffected — the derivation is now stricter, not broken.
    sessionStorage.setItem('calendar_state', 'calendar-state')
    sessionStorage.setItem('calendar_verifier', 'calendar-verifier')
    window.history.replaceState({}, '', '/?code=calendar-code&state=calendar-state')
    let connectPosts = 0
    server.use(
      // Un-prefixed only: this test sets no `calendar_workspace`, so `setWorkspaceId` never runs
      // and the client emits the bare path. A `/w/:wsId` handler here would be dead — review
      // proved it by deleting it and watching the test still pass.
      http.post('/api/calendar/connect/google', () => {
        connectPosts += 1
        return HttpResponse.json({ connected: true, provider: 'google', email: null })
      }),
    )

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    )

    // The DERIVATION is what this pins: `authLoading` is seeded from it, and it exists so the
    // sign-in screen never flashes mid-connect. Asserting only the connect POST would leave the
    // derivation untested — review proved that by replacing it with `false` and watching this test,
    // plus 28 other auth tests, stay green.
    expect(screen.getByTestId('loading')).toHaveTextContent('loading')

    await waitFor(() => expect(connectPosts).toBe(1))
    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('ready'))
    // The connect path consumes its own markers.
    expect(sessionStorage.getItem('calendar_state')).toBeNull()
  })

  // The derivation must equal the branch it predicts. It previously omitted `calendar_verifier`,
  // so a matching state with a missing verifier seeded authLoading = true, the calendar arm then
  // declined to run, and nothing cleared it — the same strand as the reported bug, through a
  // different gap, and with BUG-60's storage-blocked message suppressed by the same true value.
  it('does not strand when the state matches but the verifier is gone', async () => {
    sessionStorage.setItem('calendar_state', 'calendar-state')
    // no calendar_verifier
    window.history.replaceState({}, '', '/?code=calendar-code&state=calendar-state')

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    )

    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('ready'))
  })
})
