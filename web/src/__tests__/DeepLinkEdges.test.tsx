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
