import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import App from '../App'
import { AuthProvider } from '../auth/AuthContext'
import { clearToken } from '../auth/tokenStore'
import { ToastProvider } from '../components/ToastProvider'
import { render, screen, waitFor, within } from '../test/render'
import { server } from '../test/setup'

// Phase 49-B — the open-note tab set survives a reload, per device. Still client-side only:
// no event, no projection, no endpoint. Storage is per workspace, and a tab whose note has
// gone (deleted, or moved to another workspace) is dropped quietly on restore.

vi.mock('../components/LazyNoteEditor', () => ({
  default: ({ value, onChange, onBlur }: { value: string; onChange: (md: string) => void; onBlur: () => void }) => (
    <textarea aria-label="Note content" data-testid="note-content" value={value} onChange={(e) => onChange(e.target.value)} onBlur={onBlur} />
  ),
}))

const today = new Date().toISOString().slice(0, 10)
const now = new Date().toISOString()

const card = (noteId: string, title: string) => ({
  noteId,
  title,
  contentPreview: '',
  date: today,
  openActions: [],
  createdAt: now,
  lastModifiedAt: now,
  tags: [],
  folderId: null,
})

const STANDUP = card('note-1', 'Standup')
const CLIENT_CALL = card('note-2', 'Client call')

const KEY = 'note-taker-open-tabs-__default__'

const renderApp = () =>
  render(
    <ToastProvider>
      <AuthProvider initialToken="test-token">
        <App />
      </AuthProvider>
    </ToastProvider>,
  )

function seedCards(cards = [STANDUP, CLIENT_CALL]) {
  server.use(http.get('/api/w/:wsId/notes/cards', () => HttpResponse.json({ cards })))
}

beforeEach(() => {
  window.history.replaceState({}, '', '/')
  localStorage.clear()
  // Register `:noteId` FIRST and `cards` after: msw gives precedence to the most recently
  // registered handler, and `/notes/:noteId` matches `/notes/cards` (binding noteId="cards")
  // — the same ordering hazard handlers.ts calls out for `/calendar/connection` vs `:date`.
  server.use(
    http.get('/api/w/:wsId/notes/:noteId', ({ params }) => {
      const noteId = params.noteId as string
      return HttpResponse.json({
        noteId,
        title: noteId === 'note-2' ? 'Client call' : 'Standup',
        content: '',
        date: today,
        tags: [],
        transcriptIsDiarized: false,
      })
    }),
  )
  seedCards()
})

afterEach(() => {
  clearToken()
  localStorage.clear()
})

const tabs = () => screen.queryAllByTestId('open-note-tab')

async function openFromList(title: string) {
  const cardEl = (await screen.findAllByTestId('note-card')).find((c) => within(c).queryByText(title))
  if (!cardEl) throw new Error(`no card titled ${title}`)
  await userEvent.click(within(cardEl).getByTestId('note-card-title'))
  await screen.findByTestId('note-title-input')
}

async function goHome() {
  window.history.back()
  await waitFor(() => expect(window.location.pathname).toBe('/w/__default__'))
}

describe('Open-note tab persistence (49-B)', () => {
  it('remembers the open tabs across a reload', async () => {
    const { unmount } = renderApp()
    await openFromList('Standup')
    await goHome()
    await openFromList('Client call')
    await waitFor(() => expect(tabs()).toHaveLength(2))

    // A reload is a fresh mount on the same URL, with localStorage carried over.
    unmount()
    window.history.replaceState({}, '', '/w/__default__/notes/note-2')
    renderApp()

    await screen.findByTestId('note-title-input')
    await waitFor(() => expect(tabs()).toHaveLength(2))
    expect(screen.getByRole('button', { name: /^Standup$/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Client call$/ })).toHaveAttribute('aria-current', 'page')
  })

  it('drops a tab whose note no longer exists, with no error', async () => {
    const { unmount } = renderApp()
    await openFromList('Standup')
    await goHome()
    await openFromList('Client call')
    await waitFor(() => expect(tabs()).toHaveLength(2))

    // "Standup" is gone by the time we come back (deleted, or moved to another workspace).
    unmount()
    seedCards([CLIENT_CALL])
    window.history.replaceState({}, '', '/w/__default__/notes/note-2')
    renderApp()

    await screen.findByTestId('note-title-input')
    await waitFor(() => expect(tabs()).toHaveLength(1))
    expect(screen.queryByRole('button', { name: /^Standup$/ })).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  // The reconcile must wait for the cards list. Dropping tabs against an empty in-flight
  // list would wipe every tab on every cold start — the failure this ordering prevents.
  it('does not drop tabs while the note list is still loading', async () => {
    const { unmount } = renderApp()
    await openFromList('Standup')
    await goHome()
    await openFromList('Client call')
    await waitFor(() => expect(tabs()).toHaveLength(2))

    unmount()
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => { release = resolve })
    server.use(
      http.get('/api/w/:wsId/notes/cards', async () => {
        await gate
        return HttpResponse.json({ cards: [STANDUP, CLIENT_CALL] })
      }),
    )
    window.history.replaceState({}, '', '/w/__default__/notes/note-2')
    renderApp()

    // Cards are still in flight here — the restored tabs must already be showing and must
    // survive the list arriving.
    await waitFor(() => expect(tabs()).toHaveLength(2))
    release?.()
    await waitFor(() => expect(tabs()).toHaveLength(2))
  })

  it('keeps each workspace to its own tabs', async () => {
    const { unmount } = renderApp()
    await openFromList('Standup')
    await waitFor(() => expect(tabs()).toHaveLength(1))

    // A different workspace starts empty — its tabs live under a different key.
    unmount()
    window.history.replaceState({}, '', '/w/ws-2')
    renderApp()

    await screen.findByRole('heading', { name: 'Home' })
    expect(tabs()).toHaveLength(0)
    expect(localStorage.getItem(KEY)).not.toBeNull()
  })

  it('works normally when storage is unavailable', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError')
    })
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('SecurityError')
    })
    try {
      renderApp()
      await openFromList('Standup')

      // The bar still works in-session; it simply has nothing to restore from.
      await waitFor(() => expect(tabs()).toHaveLength(1))
      expect(screen.getByTestId('note-title-input')).toBeInTheDocument()
    } finally {
      setItem.mockRestore()
      getItem.mockRestore()
    }
  })

  it('ignores a corrupt stored value', async () => {
    localStorage.setItem(KEY, '{ this is not json')
    window.history.replaceState({}, '', '/w/__default__/notes/note-1')
    renderApp()

    await screen.findByTestId('note-title-input')
    // The route's own note is still adopted as a tab (49-A); nothing else is restored.
    await waitFor(() => expect(tabs()).toHaveLength(1))
    expect(screen.getByRole('button', { name: /^Standup$/ })).toHaveAttribute('aria-current', 'page')
  })

  it('ignores a stored value of the wrong shape', async () => {
    localStorage.setItem(KEY, JSON.stringify({ tabs: [{ nope: true }, 'nonsense', null] }))
    window.history.replaceState({}, '', '/w/__default__/notes/note-1')
    renderApp()

    await screen.findByTestId('note-title-input')
    await waitFor(() => expect(tabs()).toHaveLength(1))
  })

  it('forgets a tab that was closed', async () => {
    const { unmount } = renderApp()
    await openFromList('Standup')
    await goHome()
    await openFromList('Client call')
    await waitFor(() => expect(tabs()).toHaveLength(2))
    await userEvent.click(screen.getByRole('button', { name: 'Close Standup' }))
    await waitFor(() => expect(tabs()).toHaveLength(1))

    unmount()
    window.history.replaceState({}, '', '/w/__default__/notes/note-2')
    renderApp()

    await screen.findByTestId('note-title-input')
    await waitFor(() => expect(tabs()).toHaveLength(1))
    expect(screen.queryByRole('button', { name: /^Standup$/ })).toBeNull()
  })
})
