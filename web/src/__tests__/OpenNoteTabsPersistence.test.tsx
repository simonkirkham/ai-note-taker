import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { keys } from '../api/queryKeys'
import App from '../App'
import { AuthProvider } from '../auth/AuthContext'
import { clearToken } from '../auth/tokenStore'
import { ToastProvider } from '../components/ToastProvider'
import { render, screen, waitFor, within } from '../test/render'
import { server } from '../test/setup'

// Phase 49-B — the open-note tab set survives a reload, per device. Still client-side only:
// no event, no projection, no endpoint. Storage is per workspace, and a tab whose note has
// gone (deleted, or moved to another workspace) is dropped quietly on restore.

// The observability brief for 49-B names two signals. Both report a state that is otherwise
// completely silent — a restore that yielded nothing, and a reconcile that dropped tabs —
// so they are the only way to tell "the user had no tabs" from "the app lost them".
const recordRumEvent = vi.fn()
vi.mock('../rum', () => ({
  recordRumEvent: (type: string, data: Record<string, unknown>) => recordRumEvent(type, data),
}))

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
  recordRumEvent.mockClear()
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
    server.use(http.get('/api/w/:wsId/notes/cards', () => new HttpResponse(null, { status: 500 })))
    window.history.replaceState({}, '', '/w/__default__/notes/note-2')
    const { queryClient } = renderApp()

    await screen.findByTestId('note-title-input')
    // Assert only once the query has actually COMMITTED the error. While it is pending the
    // tabs render unfiltered, so an early assertion passes whether or not the failure is
    // handled correctly. The sync point is the query's own state — not a timer, and not
    // "the msw resolver ran", which proves the response was sent, not folded in.
    await waitFor(() => expect(queryClient.getQueryState(keys.noteCards)?.status).toBe('error'))

    expect(tabs()).toHaveLength(2)
  })

  // The other half of the same rule, and the one `isSuccess` got wrong: query-core's error
  // reducer sets status "error" even when `data` still holds the last good list. Gating on
  // `isSuccess` would therefore stop reconciling after any failed BACKGROUND refetch, so a
  // note deleted elsewhere would reappear as a tab. `dataUpdatedAt` survives the error, so
  // the last good snapshot keeps governing.
  it('still reconciles against the last good list after a refetch fails', async () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({ tabs: [{ noteId: 'note-1', title: 'Standup' }, { noteId: 'note-3', title: 'Retro' }] }),
    )
    // note-3 is NOT in the list, so a working reconcile drops it.
    seedCards([STANDUP, CLIENT_CALL])
    window.history.replaceState({}, '', '/w/__default__/notes/note-1')
    const { queryClient } = renderApp()

    await screen.findByTestId('note-title-input')
    await waitFor(() => expect(tabs()).toHaveLength(1))

    // Now break the endpoint and force a refetch: the query goes to "error" while `data`
    // still holds the good list.
    server.use(http.get('/api/w/:wsId/notes/cards', () => new HttpResponse(null, { status: 500 })))
    await queryClient.refetchQueries({ queryKey: keys.noteCards })
    await waitFor(() => expect(queryClient.getQueryState(keys.noteCards)?.status).toBe('error'))

    // Still reconciled — the dead tab must not come back.
    expect(tabs()).toHaveLength(1)
    expect(screen.queryByRole('button', { name: /^Retro$/ })).toBeNull()
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

  // Asserted on a NOTE route, not the workspace home. The bar only renders when a note is
  // open, so `expect(tabs()).toHaveLength(0)` on a home screen is true no matter what is
  // stored — the original form of this spec passed even with every workspace sharing one
  // storage key, which is the exact regression it exists to catch.
  it('keeps each workspace to its own tabs', async () => {
    const { unmount } = renderApp()
    await openFromList('Standup')
    await waitFor(() => expect(tabs()).toHaveLength(1))

    // ws-2 has nothing stored, so opening a note there gives exactly one tab — its own —
    // and never note-1 from the default workspace.
    unmount()
    window.history.replaceState({}, '', '/w/ws-2/notes/note-2')
    renderApp()

    await screen.findByTestId('note-title-input')
    await waitFor(() => expect(tabs()).toHaveLength(1))
    expect(screen.queryByRole('button', { name: /^Standup$/ })).toBeNull()
    expect(localStorage.getItem(KEY)).toContain('note-1')
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
    // note-9 must be in the cards list or the reconcile would (correctly) drop it, and the
    // spec would be testing the reconcile rather than the workspace switch.
    seedCards([STANDUP, CLIENT_CALL, card('note-9', 'Work note')])
    localStorage.setItem('note-taker-open-tabs-ws-2', JSON.stringify({ tabs: [{ noteId: 'note-9', title: 'Work note' }] }))
    renderApp()
    await openFromList('Standup')
    await waitFor(() => expect(tabs()).toHaveLength(1))

    // Switch workspace in place — no unmount.
    await userEvent.click(screen.getByTestId('workspace-switcher-trigger'))
    await userEvent.click(await screen.findByTestId('workspace-option-ws-2'))

    await waitFor(() => expect(window.location.pathname).toBe('/w/ws-2'))

    // The bar only renders on a note route, so open a note in ws-2 — in-app, still no
    // unmount — and read the bar there. Asserting on the workspace home would be vacuous:
    // the original form of this spec passed even with every workspace sharing a single
    // storage key, so it proved nothing about the render-phase adjust it was written for.
    await openFromList('Client call')

    // ws-2's own remembered tab, restored by the render-phase adjust, sitting alongside the
    // note just opened here — and NOT "Standup", which belongs to the default workspace.
    await waitFor(() => expect(screen.getByRole('button', { name: /^Work note$/ })).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /^Client call$/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Standup$/ })).toBeNull()
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
      // ...and the silence is reported. Without this the only symptom is a user saying the
      // app "forgot" their tabs, with nothing in RUM to corroborate it.
      expect(recordRumEvent).toHaveBeenCalledWith('tabRestoreFailed', { reason: 'storageUnavailable' })
    } finally {
      setItem.mockRestore()
      getItem.mockRestore()
    }
  })

  // A mass drop means the cards read came back empty or partial for a reason that is not
  // "the user deleted these" — the failure mode the observability brief calls out, and one
  // whose only visible symptom is a bar the user says went missing.
  it('reports how many tabs the reconcile dropped', async () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        tabs: [
          { noteId: 'note-1', title: 'Standup' },
          { noteId: 'gone-1', title: 'Gone one' },
          { noteId: 'gone-2', title: 'Gone two' },
        ],
      }),
    )
    seedCards([STANDUP])
    window.history.replaceState({}, '', '/w/__default__/notes/note-1')
    renderApp()

    await screen.findByTestId('note-title-input')
    await waitFor(() => expect(tabs()).toHaveLength(1))
    expect(recordRumEvent).toHaveBeenCalledWith('tabsDropped', { dropped: 2, remaining: 1 })
  })

  // The counterpart: a clean restore must stay quiet, or the signal is noise and nobody
  // will look at it.
  it('reports nothing when the reconcile drops nothing', async () => {
    localStorage.setItem(KEY, JSON.stringify({ tabs: [{ noteId: 'note-2', title: 'Client call' }] }))
    window.history.replaceState({}, '', '/w/__default__/notes/note-1')
    renderApp()

    await screen.findByTestId('note-title-input')
    await waitFor(() => expect(tabs()).toHaveLength(2))
    expect(recordRumEvent).not.toHaveBeenCalledWith('tabsDropped', expect.anything())
    expect(recordRumEvent).not.toHaveBeenCalledWith('tabRestoreFailed', expect.anything())
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
    expect(recordRumEvent).toHaveBeenCalledWith('tabRestoreFailed', { reason: 'corrupt' })
  })

  it('ignores a stored value of the wrong shape', async () => {
    localStorage.setItem(KEY, JSON.stringify({ tabs: 'nonsense' }))
    window.history.replaceState({}, '', '/w/__default__/notes/note-1')
    renderApp()

    await screen.findByTestId('note-title-input')
    await waitFor(() => expect(tabs()).toHaveLength(1))
    expect(recordRumEvent).toHaveBeenCalledWith('tabRestoreFailed', { reason: 'wrongShape' })
  })

  // Distinct from the above: `tabs` IS an array, so the value is structurally fine — the
  // entries inside it are junk. That is a per-entry skip, not a rejected value, so it must
  // not raise the restore-failed signal.
  it('skips junk entries inside an otherwise valid list', async () => {
    localStorage.setItem(KEY, JSON.stringify({ tabs: [{ nope: true }, 'nonsense', null] }))
    window.history.replaceState({}, '', '/w/__default__/notes/note-1')
    renderApp()

    await screen.findByTestId('note-title-input')
    await waitFor(() => expect(tabs()).toHaveLength(1))
  })

  // Duplicate ids are a correctness bug, not untidiness: React gets duplicate keys and two
  // tabs are both marked current. `openTab` dedupes on write, so a duplicate can only arrive
  // from a value the app did not produce. Deliberately no cap alongside it — see the note in
  // useOpenNoteTabs: a restore-only cap silently and permanently truncated a user's tabs.
  it('renders a duplicated stored id once, and a long list without a cap', async () => {
    const many = Array.from({ length: 200 }, (_, i) => ({ noteId: `bulk-${i}`, title: `Bulk ${i}` }))
    localStorage.setItem(
      KEY,
      JSON.stringify({ tabs: [{ noteId: 'note-2', title: 'Client call' }, { noteId: 'note-2', title: 'Dupe' }, ...many] }),
    )
    window.history.replaceState({}, '', '/w/__default__/notes/note-1')
    renderApp()

    await screen.findByTestId('note-title-input')
    // note-1 (viewed) + note-2 (in cards). The duplicate collapses to one — without the
    // dedupe this is 3 — and the 200 bulk ids are reconciled away because they are not in
    // the cards list, which is what bounds a hostile value rather than a cap.
    await waitFor(() => expect(tabs()).toHaveLength(2))
    expect(screen.getAllByRole('button', { name: /^Client call$/ })).toHaveLength(1)
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
