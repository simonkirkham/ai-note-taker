import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import App from '../App'
import { AuthProvider } from '../auth/AuthContext'
import { clearToken } from '../auth/tokenStore'
import { ToastProvider } from '../components/ToastProvider'
// Shared render wraps in QueryClientProvider — ListView → TodoSection reads
// server state via TanStack Query (slice 20-A).
import { render, screen, within } from '../test/render'
import { server } from '../test/setup'

// Phase 21-A — distinct URLs for home and notes; working back/forward; deep-linkable note URL.
// App owns its own <BrowserRouter>, so these tests assert against window.location.

const today = new Date().toISOString().slice(0, 10)
const now = new Date().toISOString()

const oneCard = {
  noteId: 'note-1',
  title: 'Test Note',
  contentPreview: '',
  date: today,
  openActions: [],
  createdAt: now,
  lastModifiedAt: now,
  tags: [],
  folderId: null,
}

const renderApp = () =>
  render(
    <ToastProvider>
      <AuthProvider initialToken="test-token">
        <App />
      </AuthProvider>
    </ToastProvider>,
  )

beforeEach(() => {
  window.history.replaceState({}, '', '/')
  server.use(http.get('/api/w/:wsId/notes/cards', () => HttpResponse.json({ cards: [oneCard] })))
})

afterEach(() => clearToken())

describe('Routing (21-A)', () => {
  it('opening a note pushes a /notes/:id URL', async () => {
    renderApp()
    await userEvent.click(await screen.findByTestId('note-card'))
    expect(await screen.findByTestId('note-title-input')).toBeInTheDocument()
    expect(window.location.pathname).toBe('/w/__default__/notes/note-1')
  })

  it('Back returns to the home screen', async () => {
    renderApp()
    await userEvent.click(await screen.findByTestId('note-card'))
    await screen.findByTestId('note-title-input')

    window.history.back()

    await screen.findByTestId('home-view')
    expect(window.location.pathname).toBe('/w/__default__')
    expect(screen.getByRole('heading', { name: 'Home' })).toBeInTheDocument()
  })

  it('Forward reopens the note', async () => {
    renderApp()
    await userEvent.click(await screen.findByTestId('note-card'))
    await screen.findByTestId('note-title-input')
    window.history.back()
    await screen.findByTestId('home-view')
    expect(window.location.pathname).toBe('/w/__default__')

    window.history.forward()

    expect(await screen.findByTestId('note-title-input')).toBeInTheDocument()
    expect(window.location.pathname).toBe('/w/__default__/notes/note-1')
  })

  it('deep-linking /notes/:id loads the note directly', async () => {
    window.history.replaceState({}, '', '/w/__default__/notes/note-1')
    renderApp()
    expect(await screen.findByTestId('note-title-input')).toBeInTheDocument()
    expect(window.location.pathname).toBe('/w/__default__/notes/note-1')
  })

  it('in-app Back from a cold deep-link falls back to home', async () => {
    window.history.replaceState({}, '', '/w/__default__/notes/note-1')
    renderApp()
    // A blank note shows Cancel, which calls onBack; there is no in-app history
    // entry behind a cold deep-link, so the handler must fall back to "/".
    await userEvent.click(await screen.findByTestId('cancel-button'))
    await screen.findByTestId('home-view')
    expect(window.location.pathname).toBe('/w/__default__')
    expect(screen.getByRole('heading', { name: 'Home' })).toBeInTheDocument()
  })

  it('creating a note navigates to it and Back does not recreate it', async () => {
    let creates = 0
    server.use(
      http.post('/api/w/:wsId/notes', () => {
        creates += 1
        return HttpResponse.json({ noteId: 'created-1' })
      }),
    )
    renderApp()
    await screen.findByTestId('note-card') // home loaded

    const main = screen.getByRole('main')
    await userEvent.click(within(main).getByRole('button', { name: 'New Note' }))

    await screen.findByTestId('note-title-input')
    expect(window.location.pathname).toBe('/w/__default__/notes/created-1')
    expect(creates).toBe(1)

    window.history.back()

    await screen.findByTestId('home-view')
    expect(window.location.pathname).toBe('/w/__default__')
    expect(creates).toBe(1)
  })
})
