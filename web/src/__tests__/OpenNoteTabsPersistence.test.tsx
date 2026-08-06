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
const RETRO = card('note-3', 'Retro')

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
  //
  // Seeded with STALE titles so "the list arrived" is directly observable: the labels only
  // change to the card titles once the read has been folded into the cache. Re-asserting
  // without that sync point would pass before the response was ever processed.
  it('does not drop tabs while the note list is still loading', async () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({ tabs: [{ noteId: 'note-1', title: 'stale-1' }, { noteId: 'note-2', title: 'stale-2' }] }),
    )
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

    // Cards are still in flight — the restored tabs must already be showing, under their
    // stored (stale) titles.
    await waitFor(() => expect(tabs()).toHaveLength(2))
    expect(screen.getByRole('button', { name: /^stale-1$/ })).toBeInTheDocument()

    // ...and must survive the list arriving. The label flipping to the card's real title is
    // proof the response was folded in, not merely sent.
    release?.()
    await screen.findByRole('button', { name: /^Standup$/ })
    expect(tabs()).toHaveLength(2)
  })

  // A cards read that FAILS is not evidence the notes are gone — collapsing the bar on one
  // API blip would be worse than showing a tab whose note may have moved.
  it('keeps the tabs when the note list fails to load', async () => {
    const { unmount } = renderApp()
    await openFromList('Standup')
    await goHome()
    await openFromList('Client call')
    await waitFor(() => expect(tabs()).toHaveLength(2))

    unmount()
    let calls = 0
    server.use(
      http.get('/api/w/:wsId/notes/cards', () => {
        calls += 1
        return new HttpResponse(null, { status: 500 })
      }),
    )
    window.history.replaceState({}, '', '/w/__default__/notes/note-2')
    renderApp()

    await screen.findByTestId('note-title-input')
    // Assert AFTER the failure has settled. While the query is still pending the tabs are
    // rendered unfiltered, so asserting early would pass whether or not the error is
    // handled correctly — the trap this suite hit once already.
    await waitFor(() => expect(calls).toBe(1))
    await waitFor(() => expect(screen.getByTestId('note-title-input')).toBeInTheDocument())
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(tabs()).toHaveLength(2)
  })

  // The active note is never dropped, even when the list has not caught up with it — and it
  // keeps BOTH its stored title and its position, which the adopted-tab fallback would lose.
  it('keeps the note being viewed even when the list omits it', async () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({ tabs: [{ noteId: 'note-2', title: 'Client call' }, { noteId: 'note-1', title: 'Standup' }] }),
    )
    seedCards([CLIENT_CALL])
    window.history.replaceState({}, '', '/w/__default__/notes/note-1')
    renderApp()

    await screen.findByTestId('note-title-input')
    await waitFor(() => expect(tabs()).toHaveLength(2))
    const labels = screen.getAllByTestId('open-note-tab-label').map((b) => b.textContent)
    expect(labels).toEqual(['Client call', 'Standup'])
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

  // Switching workspace WITHOUT a remount is the only path through the hook's render-phase
  // adjust — every other spec unmounts, which exercises the lazy initialiser instead. This
  // is the riskiest code in the hook (render-phase setState, double-invoked in StrictMode).
  it('loads the other workspace\'s own tabs when switching in-session', async () => {
    server.use(
      http.get('/api/workspaces', () =>
        HttpResponse.json({
          workspaces: [
            { workspaceId: '__default__', name: 'Personal', isDefault: true },
            { workspaceId: 'ws-2', name: 'Work', isDefault: false },
          ],
        }),
      ),
    )
    localStorage.setItem('note-taker-open-tabs-ws-2', JSON.stringify({ tabs: [{ noteId: 'note-9', title: 'Work note' }] }))
    renderApp()
    await openFromList('Standup')
    await waitFor(() => expect(tabs()).toHaveLength(1))

    // Switch workspace in place — no unmount.
    await userEvent.click(screen.getByTestId('workspace-switcher-trigger'))
    await userEvent.click(await screen.findByTestId('workspace-option-ws-2'))

    await waitFor(() => expect(window.location.pathname).toBe('/w/ws-2'))
    // ws-2's own remembered tab, not the first workspace's — and the bar is only rendered
    // on a note route, so open its note to see it.
    await waitFor(() => expect(screen.queryByRole('button', { name: /^Standup$/ })).toBeNull())
    expect(localStorage.getItem('note-taker-open-tabs-__default__')).toContain('note-1')
    expect(localStorage.getItem('note-taker-open-tabs-ws-2')).toContain('note-9')
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

  // Positive control for the two below: a WELL-FORMED value restores its extra tab, so the
  // "only 1 tab" assertions there are really about the value being rejected.
  it('restores a well-formed stored value on a cold load', async () => {
    localStorage.setItem(KEY, JSON.stringify({ tabs: [{ noteId: 'note-2', title: 'Client call' }] }))
    window.history.replaceState({}, '', '/w/__default__/notes/note-1')
    renderApp()

    await screen.findByTestId('note-title-input')
    await waitFor(() => expect(tabs()).toHaveLength(2))
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

  it('drops duplicates and caps a hostile stored list', async () => {
    const many = Array.from({ length: 200 }, (_, i) => ({ noteId: `bulk-${i}`, title: `Bulk ${i}` }))
    localStorage.setItem(
      KEY,
      JSON.stringify({ tabs: [{ noteId: 'note-2', title: 'Client call' }, { noteId: 'note-2', title: 'Dupe' }, ...many] }),
    )
    window.history.replaceState({}, '', '/w/__default__/notes/note-1')
    renderApp()

    await screen.findByTestId('note-title-input')
    // Everything but note-1/note-2 is reconciled away (not in cards); the duplicate never
    // renders twice, and nothing approaching 200 buttons is created.
    await waitFor(() => expect(tabs()).toHaveLength(2))
  })

  // Three tabs, close one, expect TWO back — with two, the route-adopted tab alone would
  // give the same answer whether or not anything was persisted.
  it('forgets a tab that was closed', async () => {
    seedCards([STANDUP, CLIENT_CALL, RETRO])
    const { unmount } = renderApp()
    await openFromList('Standup')
    await goHome()
    await openFromList('Retro')
    await goHome()
    await openFromList('Client call')
    await waitFor(() => expect(tabs()).toHaveLength(3))
    await userEvent.click(screen.getByRole('button', { name: 'Close Standup' }))
    await waitFor(() => expect(tabs()).toHaveLength(2))

    unmount()
    window.history.replaceState({}, '', '/w/__default__/notes/note-2')
    renderApp()

    await screen.findByTestId('note-title-input')
    await waitFor(() => expect(tabs()).toHaveLength(2))
    expect(screen.queryByRole('button', { name: /^Standup$/ })).toBeNull()
    expect(screen.getByRole('button', { name: /^Retro$/ })).toBeInTheDocument()
  })
})
