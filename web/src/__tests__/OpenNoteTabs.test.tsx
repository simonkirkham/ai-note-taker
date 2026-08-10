import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { useState } from 'react'
import App from '../App'
import { AuthProvider } from '../auth/AuthContext'
import { clearToken } from '../auth/tokenStore'
import { ToastProvider } from '../components/ToastProvider'
import type { TranscriptionStatus, UseTranscriptionResult } from '../hooks/useTranscription'
import { render, screen, waitFor, within } from '../test/render'
import { server } from '../test/setup'

// Phase 49-A — several notes open at once in a tab bar. The bar is client-side only: no
// events, no projection, no endpoint. Tabs are `{noteId, title}`; only the ACTIVE tab's
// NoteView is mounted (switching is the existing route navigation), so the note lifecycle
// is unchanged from the single-note model.

// NoteView renders the editor through LazyNoteEditor — swap in the synchronous textarea
// stand-in (same mock NoteView.test.tsx uses) so these tests are free of Suspense timing.
vi.mock('../components/LazyNoteEditor', () => ({
  default: ({ value, onChange, onBlur }: { value: string; onChange: (md: string) => void; onBlur: () => void }) => (
    <textarea
      aria-label="Note content"
      data-testid="note-content"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur}
    />
  ),
}))

// Stateful transcription stand-in so the recording-guard scenario can drive a note into
// `recording` without touching the mic/socket.
vi.mock('../hooks/useTranscription', () => ({
  useTranscription: (): UseTranscriptionResult => {
    const [status, setStatus] = useState<TranscriptionStatus>('idle')
    const [transcript, setTranscript] = useState('')
    return {
      status,
      transcript,
      elapsedSeconds: 0,
      error: undefined,
      recordingUpload: 'idle',
      diarization: 'idle',
      startRecording: () => { setStatus('recording'); setTranscript('live words') },
      stopRecording: () => setStatus('stopped'),
      awaitCommit: async () => {},
      reset: () => { setStatus('idle'); setTranscript('') },
    }
  },
}))

vi.mock('../components/RecordControl', () => ({
  default: ({ transcription }: { transcription: UseTranscriptionResult }) => (
    <button data-testid="mock-start-recording" onClick={() => transcription.startRecording(true, true)}>
      Start recording
    </button>
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

const renderApp = () =>
  render(
    <ToastProvider>
      <AuthProvider initialToken="test-token">
        <App />
      </AuthProvider>
    </ToastProvider>,
  )

// Note content is served from an in-memory store so a save made before a tab switch is
// really read back on return (rather than the fixed default handler hiding a lost write).
let content: Record<string, string>

beforeEach(() => {
  window.history.replaceState({}, '', '/')
  content = { 'note-1': '', 'note-2': '' }
  server.use(
    http.get('/api/w/:wsId/notes/cards', () => HttpResponse.json({ cards: [STANDUP, CLIENT_CALL] })),
    http.get('/api/w/:wsId/notes/:noteId', ({ params }) => {
      const noteId = params.noteId as string
      const title = noteId === 'note-2' ? 'Client call' : 'Standup'
      return HttpResponse.json({
        noteId,
        title,
        content: content[noteId] ?? '',
        date: today,
        tags: [],
        transcriptIsDiarized: false,
      })
    }),
    http.put('/api/w/:wsId/notes/:noteId/content', async ({ params, request }) => {
      const body = (await request.json()) as { content: string }
      content[params.noteId as string] = body.content
      return new HttpResponse(null, { status: 204 })
    }),
  )
})

afterEach(() => clearToken())

const tabs = () => screen.queryAllByTestId('open-note-tab')
const tabNamed = (title: string) =>
  screen.getByRole('button', { name: new RegExp(`^${title}$`) })

/** Open a note from the home list by its card title. */
async function openFromList(title: string) {
  const cardEl = (await screen.findAllByTestId('note-card')).find((c) => within(c).queryByText(title))
  if (!cardEl) throw new Error(`no card titled ${title}`)
  await userEvent.click(within(cardEl).getByTestId('note-card-title'))
  await screen.findByTestId('note-title-input')
}

/** Back to the home list (browser Back — leaves the tab set untouched). */
async function goHome() {
  window.history.back()
  await waitFor(() => expect(window.location.pathname).toBe('/w/__default__'))
}

describe('Open-note tabs (49-A)', () => {
  it('opening a second note keeps the first open', async () => {
    renderApp()
    await openFromList('Standup')
    await goHome()
    await openFromList('Client call')

    await waitFor(() => expect(tabs()).toHaveLength(2))
    expect(tabNamed('Standup')).toBeInTheDocument()
    expect(tabNamed('Client call')).toHaveAttribute('aria-current', 'page')
    expect(window.location.pathname).toBe('/w/__default__/notes/note-2')
  })

  it('clicking a tab shows that note and updates the address bar', async () => {
    renderApp()
    await openFromList('Standup')
    await goHome()
    await openFromList('Client call')
    await waitFor(() => expect(tabs()).toHaveLength(2))

    await userEvent.click(tabNamed('Standup'))

    await waitFor(() => expect(window.location.pathname).toBe('/w/__default__/notes/note-1'))
    await waitFor(() => expect(screen.getByTestId('note-title-input')).toHaveValue('Standup'))
    expect(tabNamed('Standup')).toHaveAttribute('aria-current', 'page')
  })

  it('opening an already-open note focuses its tab instead of duplicating it', async () => {
    renderApp()
    await openFromList('Standup')
    await goHome()
    await openFromList('Client call')
    await waitFor(() => expect(tabs()).toHaveLength(2))
    await goHome()

    await openFromList('Standup')

    expect(tabs()).toHaveLength(2)
    expect(tabNamed('Standup')).toHaveAttribute('aria-current', 'page')
  })

  it('closing a tab I am not looking at leaves the current note in place', async () => {
    renderApp()
    await openFromList('Standup')
    await goHome()
    await openFromList('Client call')
    await waitFor(() => expect(tabs()).toHaveLength(2))

    await userEvent.click(screen.getByRole('button', { name: 'Close Standup' }))

    await waitFor(() => expect(tabs()).toHaveLength(1))
    expect(window.location.pathname).toBe('/w/__default__/notes/note-2')
    expect(tabNamed('Client call')).toHaveAttribute('aria-current', 'page')
  })

  it('closing the tab I am looking at moves to the neighbouring tab', async () => {
    renderApp()
    await openFromList('Standup')
    await goHome()
    await openFromList('Client call')
    await waitFor(() => expect(tabs()).toHaveLength(2))

    await userEvent.click(screen.getByRole('button', { name: 'Close Client call' }))

    await waitFor(() => expect(window.location.pathname).toBe('/w/__default__/notes/note-1'))
    expect(tabs()).toHaveLength(1)
    expect(tabNamed('Standup')).toHaveAttribute('aria-current', 'page')
  })

  // The "next along" branch of neighbourOf — closing the LAST tab falls through to the
  // previous one, so a two-tab test alone never exercises it.
  it('closing a middle tab moves to the next one along', async () => {
    server.use(
      http.get('/api/w/:wsId/notes/cards', () =>
        HttpResponse.json({ cards: [STANDUP, CLIENT_CALL, card('note-3', 'Retro')] }),
      ),
    )
    renderApp()
    await openFromList('Standup')
    await goHome()
    await openFromList('Client call')
    await goHome()
    await openFromList('Retro')
    await waitFor(() => expect(tabs()).toHaveLength(3))

    // Make the MIDDLE tab active, then close it.
    await userEvent.click(tabNamed('Client call'))
    await waitFor(() => expect(window.location.pathname).toBe('/w/__default__/notes/note-2'))
    await userEvent.click(screen.getByRole('button', { name: 'Close Client call' }))

    await waitFor(() => expect(window.location.pathname).toBe('/w/__default__/notes/note-3'))
    expect(tabs()).toHaveLength(2)
    expect(tabNamed('Retro')).toHaveAttribute('aria-current', 'page')
  })

  // The note in the URL is always a tab, however it got there — otherwise the bar shows
  // tabs with no active one, or nothing at all while a note is plainly open.
  it('a cold deep-link to a note shows it as a tab', async () => {
    window.history.replaceState({}, '', '/w/__default__/notes/note-1')
    renderApp()
    await screen.findByTestId('note-title-input')

    await waitFor(() => expect(tabs()).toHaveLength(1))
    expect(tabNamed('Standup')).toHaveAttribute('aria-current', 'page')
  })

  it('going back onto a note whose tab was closed shows it as a tab again', async () => {
    renderApp()
    await openFromList('Standup')
    await goHome()
    await openFromList('Client call')
    await waitFor(() => expect(tabs()).toHaveLength(2))

    // Switch to Standup (pushes its entry), then close that tab — which navigates on to the
    // neighbour. Browser-Back now lands on a note with no tab of its own.
    await userEvent.click(tabNamed('Standup'))
    await waitFor(() => expect(window.location.pathname).toBe('/w/__default__/notes/note-1'))
    await userEvent.click(screen.getByRole('button', { name: 'Close Standup' }))
    await waitFor(() => expect(window.location.pathname).toBe('/w/__default__/notes/note-2'))
    expect(tabs()).toHaveLength(1)

    window.history.back()

    await waitFor(() => expect(window.location.pathname).toBe('/w/__default__/notes/note-1'))
    await waitFor(() => expect(tabs()).toHaveLength(2))
    expect(tabNamed('Standup')).toHaveAttribute('aria-current', 'page')
  })

  it('closing the last tab returns to the notes list', async () => {
    renderApp()
    await openFromList('Standup')
    await waitFor(() => expect(tabs()).toHaveLength(1))

    await userEvent.click(screen.getByRole('button', { name: 'Close Standup' }))

    await waitFor(() => expect(window.location.pathname).toBe('/w/__default__'))
    expect(await screen.findByRole('heading', { name: 'Home' })).toBeInTheDocument()
  })

  // 49-A's "no tab bar is shown on the home list" and this test's bar-absent assertion
  // were both DELIBERATELY INVERTED by 51-B: the bar is now permanent. What replaces
  // them — the bar remaining with only the pinned tab — is asserted in the 51-B block.

  it('content typed in a tab is saved when switching away and is there on return', async () => {
    renderApp()
    await openFromList('Standup')
    await goHome()
    await openFromList('Client call')
    await waitFor(() => expect(tabs()).toHaveLength(2))

    // Type into "Client call", then switch to "Standup" without an explicit save.
    await userEvent.type(await screen.findByLabelText('Note content'), 'agreed the scope')
    await userEvent.click(tabNamed('Standup'))
    await waitFor(() => expect(window.location.pathname).toBe('/w/__default__/notes/note-1'))
    await waitFor(() => expect(content['note-2']).toBe('agreed the scope'))

    await userEvent.click(tabNamed('Client call'))

    await waitFor(() => expect(screen.getByLabelText('Note content')).toHaveValue('agreed the scope'))
  })

  // The slice's real risk: a tab click is an in-app navigate, which does NOT fire the
  // popstate trap BUG-34 added — so the recording note must be asked about explicitly, or
  // switching tabs silently kills the capture.
  it('switching tabs while recording asks first, and declining keeps the recording', async () => {
    renderApp()
    await openFromList('Standup')
    await goHome()
    await openFromList('Client call')
    await waitFor(() => expect(tabs()).toHaveLength(2))

    await userEvent.click(screen.getByTestId('mock-start-recording'))

    await userEvent.click(tabNamed('Standup'))

    // Still on the recording note, with the existing leave confirmation showing.
    expect(await screen.findByTestId('confirm-leave-button')).toBeInTheDocument()
    expect(window.location.pathname).toBe('/w/__default__/notes/note-2')

    await userEvent.click(screen.getByTestId('cancel-leave-button'))

    expect(screen.queryByTestId('confirm-leave-button')).toBeNull()
    expect(window.location.pathname).toBe('/w/__default__/notes/note-2')
  })

  // CHANGE-33: the confirm names its destination, so a tab click and a tab close — which
  // look identical behind a bare "Still recording —" — are told apart before confirming.
  it('the confirm names the tab I clicked', async () => {
    renderApp()
    await openFromList('Standup')
    await goHome()
    await openFromList('Client call')
    await waitFor(() => expect(tabs()).toHaveLength(2))
    await userEvent.click(screen.getByTestId('mock-start-recording'))

    await userEvent.click(tabNamed('Standup'))

    expect((await screen.findByTestId('leave-confirm-text')).textContent).toBe(
      'Still recording — open Standup?',
    )
  })

  it('the confirm says close this tab when I close the recording tab', async () => {
    renderApp()
    await openFromList('Standup')
    await goHome()
    await openFromList('Client call')
    await waitFor(() => expect(tabs()).toHaveLength(2))
    await userEvent.click(screen.getByTestId('mock-start-recording'))

    await userEvent.click(screen.getByRole('button', { name: 'Close Client call' }))

    expect((await screen.findByTestId('leave-confirm-text')).textContent).toBe(
      'Still recording — close this tab?',
    )
  })

  it('confirming the leave switches to the tab that was clicked', async () => {
    renderApp()
    await openFromList('Standup')
    await goHome()
    await openFromList('Client call')
    await waitFor(() => expect(tabs()).toHaveLength(2))
    await userEvent.click(screen.getByTestId('mock-start-recording'))

    await userEvent.click(tabNamed('Standup'))
    await userEvent.click(await screen.findByTestId('confirm-leave-button'))

    await waitFor(() => expect(window.location.pathname).toBe('/w/__default__/notes/note-1'))
    expect(tabs()).toHaveLength(2)
  })

  // A tab pointing at a note that no longer exists here can only reach the dead-link
  // recovery, so removing the note must remove its tab.
  it('deleting the open note removes its tab', async () => {
    server.use(http.delete('/api/w/:wsId/notes/:noteId', () => new HttpResponse(null, { status: 204 })))
    renderApp()
    await openFromList('Standup')
    await goHome()
    await openFromList('Client call')
    await waitFor(() => expect(tabs()).toHaveLength(2))

    await userEvent.click(await screen.findByTestId('delete-note-button'))

    await waitFor(() => expect(window.location.pathname).toBe('/w/__default__'))
    await openFromList('Standup')
    expect(tabs()).toHaveLength(1)
    expect(screen.queryByRole('button', { name: 'Close Client call' })).toBeNull()
  })

  it('the bar is a labelled landmark and every tab is a real button', async () => {
    renderApp()
    await openFromList('Standup')

    const bar = await screen.findByTestId('open-note-tabs')
    expect(bar).toHaveAccessibleName('Open notes')
    expect(tabNamed('Standup').tagName).toBe('BUTTON')
    expect(screen.getByRole('button', { name: 'Close Standup' }).tagName).toBe('BUTTON')
  })

  // ── 51-B ── the bar is permanent ────────────────────────────────────────────
  //
  // The bug: the bar existed only on a note route, so going Home hid every open note
  // and opening one made the whole row reappear at once. The bar now renders on every
  // screen, with the notes list as a pinned leftmost tab that is highlighted whenever
  // the user is not reading a note.
  //
  // The pinned tab deliberately does NOT carry `data-testid="open-note-tab"`: it would
  // shift every count assertion by one, and AppPage.CloseAllTabsExceptAsync loops
  // `while count > 1` clicking a close button the pinned tab does not have — a suite hang.
  describe('51-B — the bar is permanent', () => {
    const homeTab = () => screen.getByTestId('open-note-tab-home')

    it('shows the bar on the notes list holding only My notes when nothing is open', async () => {
      renderApp()
      await screen.findAllByTestId('note-card')

      expect(await screen.findByTestId('open-note-tabs')).toBeInTheDocument()
      expect(tabs()).toHaveLength(0)
      expect(homeTab()).toHaveAttribute('aria-current', 'page')
    })

    it('going back via the My notes tab keeps the open notes visible', async () => {
      renderApp()
      await openFromList('Standup')
      await goHome()
      await openFromList('Client call')
      await waitFor(() => expect(tabs()).toHaveLength(2))

      await userEvent.click(homeTab())

      await waitFor(() => expect(window.location.pathname).toBe('/w/__default__'))
      expect(tabs()).toHaveLength(2)
      expect(homeTab()).toHaveAttribute('aria-current', 'page')
    })

    it('opening a note moves the highlight off My notes and disturbs nothing else', async () => {
      renderApp()
      await openFromList('Standup')
      await goHome()
      await openFromList('Client call')
      await waitFor(() => expect(tabs()).toHaveLength(2))
      const before = tabs().map((el) => el.getAttribute('data-note-id'))

      await userEvent.click(tabNamed('Standup'))

      await waitFor(() => expect(tabNamed('Standup')).toHaveAttribute('aria-current', 'page'))
      expect(homeTab()).not.toHaveAttribute('aria-current')
      // Same tabs, same order — the highlight is the ONLY thing that moved.
      expect(tabs().map((el) => el.getAttribute('data-note-id'))).toEqual(before)
    })

    it('searching keeps my open notes in view', async () => {
      renderApp()
      await openFromList('Standup')
      await goHome()
      await waitFor(() => expect(tabs()).toHaveLength(1))

      await userEvent.type(screen.getByLabelText('Search notes'), 'client')

      expect(tabs()).toHaveLength(1)
      expect(screen.getByTestId('open-note-tabs')).toBeInTheDocument()
    })

    // On a folder screen the notes list is the current ITEM in the bar, but not the page
    // you are on — announcing it as "current page" there would be a lie.
    it('marks My notes as the current page only on the notes list itself', async () => {
      renderApp()
      await screen.findAllByTestId('note-card')
      expect(homeTab()).toHaveAttribute('aria-current', 'page')

      await userEvent.click(screen.getByTestId('unfiled-notes-button'))

      await waitFor(() => expect(window.location.pathname).toBe('/w/__default__/folders/unfiled'))
      expect(homeTab()).toHaveAttribute('aria-current', 'true')
    })

    it('the My notes tab offers no way to close it', async () => {
      renderApp()
      await openFromList('Standup')

      expect(within(homeTab().closest('li') as HTMLElement).queryByTestId('open-note-tab-close')).toBeNull()
    })

    it('closing the last note leaves the bar holding only My notes', async () => {
      renderApp()
      await openFromList('Standup')
      await waitFor(() => expect(tabs()).toHaveLength(1))

      await userEvent.click(screen.getByRole('button', { name: 'Close Standup' }))

      await waitFor(() => expect(window.location.pathname).toBe('/w/__default__'))
      expect(screen.getByTestId('open-note-tabs')).toBeInTheDocument()
      expect(tabs()).toHaveLength(0)
      expect(homeTab()).toHaveAttribute('aria-current', 'page')
    })

    it('browsing a folder keeps My notes highlighted and the open notes in view', async () => {
      renderApp()
      await openFromList('Standup')
      await waitFor(() => expect(tabs()).toHaveLength(1))

      await userEvent.click(screen.getByTestId('unfiled-notes-button'))

      await waitFor(() => expect(window.location.pathname).toBe('/w/__default__/folders/unfiled'))
      expect(tabs()).toHaveLength(1)
      // "true", not "page" — see the aria-current test below.
      expect(homeTab()).toHaveAttribute('aria-current', 'true')
    })
  })

})
