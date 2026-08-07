import { http, HttpResponse } from 'msw'
import App from '../App'
import { AuthProvider } from '../auth/AuthContext'
import { clearToken } from '../auth/tokenStore'
import { ToastProvider } from '../components/ToastProvider'
import { render, screen, waitFor } from '../test/render'
import { server } from '../test/setup'

// Phase 21-C — deep-link edge cases: missing note recovers; a signed-out deep
// link survives sign-in.

const renderApp = () =>
  render(
    <ToastProvider>
      <AuthProvider initialToken="test-token">
        <App />
      </AuthProvider>
    </ToastProvider>,
  )

afterEach(() => {
  clearToken()
  sessionStorage.clear()
})

describe('DeepLinkEdges (21-C)', () => {
  it('deep-linking a missing note redirects home with a toast', async () => {
    server.use(http.get('/api/w/:wsId/notes/:noteId', () => new HttpResponse(null, { status: 404 })))
    window.history.replaceState({}, '', '/w/__default__/notes/ghost')

    renderApp()

    await waitFor(() => expect(window.location.pathname).toBe('/w/__default__'))
    expect(await screen.findByRole('alert')).toHaveTextContent(/no longer exists/i)
  })

  // BUG-62: the case above stubs a 404, which is what a valid-but-missing id returns. A
  // MALFORMED id never reaches the handler at all — `GetNote` binds its route parameter as a
  // `Guid`, so minimal-API binding rejects it with 400 first. Recovery used to be gated on the
  // error message containing "404", so this dead-ended on a broken note screen with no way back.
  // The E2E (DeepLinkJourney) uses exactly such an id and red-gated deploy #720 on it, while this
  // suite stayed green precisely because the stub above hard-codes the friendlier status.
  it('deep-linking a malformed note id redirects home with a toast', async () => {
    server.use(http.get('/api/w/:wsId/notes/:noteId', () => new HttpResponse(null, { status: 400 })))
    window.history.replaceState({}, '', '/w/__default__/notes/missing-not-a-guid')

    renderApp()

    await waitFor(() => expect(window.location.pathname).toBe('/w/__default__'))
    expect(await screen.findByRole('alert')).toHaveTextContent(/no longer exists/i)
  })

  it('restores the requested deep-link after sign-in', async () => {
    // Simulates the OAuth round-trip: signIn() stashed the path, the callback
    // lands on "/", and the gate restores the stashed destination once authed.
    sessionStorage.setItem('postLoginRedirect', '/w/__default__/notes/note-1')
    window.history.replaceState({}, '', '/')

    renderApp()

    await waitFor(() => expect(window.location.pathname).toBe('/w/__default__/notes/note-1'))
    expect(await screen.findByTestId('note-title-input')).toBeInTheDocument()
  })
})
