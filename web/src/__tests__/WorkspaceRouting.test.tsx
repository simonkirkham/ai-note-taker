import { http, HttpResponse } from 'msw'
import App from '../App'
import { AuthProvider } from '../auth/AuthContext'
import { clearToken } from '../auth/tokenStore'
import { ToastProvider } from '../components/ToastProvider'
import { render, waitFor } from '../test/render'
import { server } from '../test/setup'

// Phase 23-D — the SPA is workspace-addressed: every screen lives under `/w/:wsId`,
// `/` and unknown paths redirect to the default workspace, and the api client targets
// the active workspace's `/w/{wsId}` prefix.

const renderApp = () =>
  render(
    <ToastProvider>
      <AuthProvider initialToken="test-token">
        <App />
      </AuthProvider>
    </ToastProvider>,
  )

afterEach(() => clearToken())

describe('Workspace routing (23-D)', () => {
  it('redirects bare / to the default workspace', async () => {
    window.history.replaceState({}, '', '/')
    renderApp()
    await waitFor(() => expect(window.location.pathname).toBe('/w/__default__'))
  })

  it('redirects an unknown top-level path to the default workspace', async () => {
    window.history.replaceState({}, '', '/totally/unknown')
    renderApp()
    await waitFor(() => expect(window.location.pathname).toBe('/w/__default__'))
  })

  it('targets the active workspace prefix on the note-cards API call', async () => {
    let cardsPath: string | null = null
    server.use(
      http.get('/api/w/:wsId/notes/cards', ({ request }) => {
        cardsPath = new URL(request.url).pathname
        return HttpResponse.json({ cards: [] })
      }),
    )
    window.history.replaceState({}, '', '/w/myteam')
    renderApp()
    await waitFor(() => expect(cardsPath).toBe('/api/w/myteam/notes/cards'))
  })
})
