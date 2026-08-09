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

// BUG-54: every navigation AWAY from a recording note that isn't the note's own Save/back
// silently unmounts it and loses the transcript. The BUG-34 popstate trap only sees browser
// Back; sidebar Home / a folder / Unfiled / a workspace switch all call `navigate` directly,
// which pushes. 49-A closed this for tab switch/close and `openNote`; these are the rest.

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
      reset: () => { setStatus('idle'); setTranscript('') },
    }
  },
}))

vi.mock('../components/RecordControl', () => ({
  default: ({ transcription }: { transcription: UseTranscriptionResult }) => (
    <>
      <button data-testid="mock-start-recording" onClick={() => transcription.startRecording(true, true)}>
        Start recording
      </button>
      <button data-testid="mock-stop-recording" onClick={() => transcription.stopRecording()}>
        Stop recording
      </button>
    </>
  ),
}))

const today = new Date().toISOString().slice(0, 10)
const now = new Date().toISOString()

const CARD = {
  noteId: 'note-1',
  title: 'Standup',
  contentPreview: '',
  date: today,
  openActions: [],
  createdAt: now,
  lastModifiedAt: now,
  tags: [],
  folderId: null,
}

const FOLDER = { folderId: 'folder-1', name: 'Clients', parentFolderId: null, children: [] }

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
  server.use(
    http.get('/api/w/:wsId/notes/cards', () => HttpResponse.json({ cards: [CARD] })),
    http.get('/api/w/:wsId/folders', () => HttpResponse.json({ folders: [FOLDER] })),
    http.get('/api/w/:wsId/notes/:noteId', () =>
      HttpResponse.json({
        noteId: 'note-1',
        title: 'Standup',
        content: '',
        date: today,
        tags: [],
        transcriptIsDiarized: false,
      }),
    ),
  )
})

afterEach(() => clearToken())

/** Open the note (by card title, since some cases render more than one) and record in it. */
async function openNoteAndRecord(title = 'Standup') {
  const cards = await screen.findAllByTestId('note-card')
  const card = cards.find((c) => within(c).queryByText(title))
  if (!card) throw new Error(`no card titled ${title}`)
  await userEvent.click(within(card).getByTestId('note-card-title'))
  await screen.findByTestId('note-title-input')
  await userEvent.click(screen.getByTestId('mock-start-recording'))
}

const NOTE_PATH = '/w/__default__/notes/note-1'

describe('BUG-54 — navigating away from a recording note asks first', () => {
  it('clicking Home while recording asks before leaving', async () => {
    renderApp()
    await openNoteAndRecord()

    await userEvent.click(within(screen.getByTestId('sidebar')).getByTestId('home-button'))

    expect(await screen.findByTestId('confirm-leave-button')).toBeInTheDocument()
    expect(window.location.pathname).toBe(NOTE_PATH)
  })

  it('declining keeps me on the note with the recording running', async () => {
    renderApp()
    await openNoteAndRecord()
    await userEvent.click(within(screen.getByTestId('sidebar')).getByTestId('home-button'))
    await screen.findByTestId('confirm-leave-button')

    await userEvent.click(screen.getByTestId('cancel-leave-button'))

    expect(screen.queryByTestId('confirm-leave-button')).toBeNull()
    expect(window.location.pathname).toBe(NOTE_PATH)
    expect(screen.getByTestId('note-title-input')).toBeInTheDocument()
  })

  it('confirming goes to the destination I actually clicked', async () => {
    renderApp()
    await openNoteAndRecord()
    await userEvent.click(within(screen.getByTestId('sidebar')).getByTestId('home-button'))

    await userEvent.click(await screen.findByTestId('confirm-leave-button'))

    await waitFor(() => expect(window.location.pathname).toBe('/w/__default__'))
  })

  it('clicking a folder while recording asks before leaving', async () => {
    renderApp()
    await openNoteAndRecord()

    await userEvent.click(await screen.findByText('Clients'))

    expect(await screen.findByTestId('confirm-leave-button')).toBeInTheDocument()
    expect(window.location.pathname).toBe(NOTE_PATH)

    await userEvent.click(screen.getByTestId('confirm-leave-button'))
    await waitFor(() => expect(window.location.pathname).toBe('/w/__default__/folders/folder-1'))
  })

  it('clicking Unfiled while recording asks before leaving', async () => {
    renderApp()
    await openNoteAndRecord()

    await userEvent.click(screen.getByTestId('unfiled-notes-button'))

    expect(await screen.findByTestId('confirm-leave-button')).toBeInTheDocument()
    expect(window.location.pathname).toBe(NOTE_PATH)

    await userEvent.click(screen.getByTestId('confirm-leave-button'))
    await waitFor(() => expect(window.location.pathname).toBe('/w/__default__/folders/unfiled'))
  })

  // The destination's side effects must wait for the leave too — declining has to leave
  // the app exactly as it was, not half-navigated. This drives the PREVIEW PANEL's own
  // open-note path (FolderPreviewPanel.onEditNote), which closes the panel as a side
  // effect: the panel must still be open, showing its folder, after declining.
  it('declining a note click in the folder preview leaves the panel open', async () => {
    // The panel lists notes in the folder. Put a SECOND note there and click that one —
    // clicking the note you are already on is a no-op navigation that unmounts nothing,
    // so it would not be a genuine leave.
    const other = { ...CARD, noteId: 'note-2', title: 'Retro', folderId: 'folder-1' }
    server.use(
      http.get('/api/w/:wsId/notes/cards', () =>
        HttpResponse.json({ cards: [{ ...CARD, folderId: 'folder-1' }, other] }),
      ),
    )
    renderApp()
    await openNoteAndRecord()

    // Open the preview panel from the sidebar — this does not navigate.
    await userEvent.click(await screen.findByRole('button', { name: 'Preview folder notes' }))
    const panel = screen.getByTestId('folder-preview-panel')
    expect(within(panel).getByText('Retro')).toBeInTheDocument()

    // Clicking a note in the panel opens it AND closes the panel — both must wait.
    await userEvent.click(within(panel).getByText('Retro'))
    expect(await screen.findByTestId('confirm-leave-button')).toBeInTheDocument()

    await userEvent.click(screen.getByTestId('cancel-leave-button'))

    // Assert on the note LIST, not the header: the header keeps the last folder name even
    // when closed, so it stays "Clients" either way and would hide the regression.
    expect(within(screen.getByTestId('folder-preview-panel')).getByText('Retro')).toBeInTheDocument()
    expect(window.location.pathname).toBe(NOTE_PATH)
  })

  // Re-opening the note you are already on changes no route, so nothing unmounts — asking
  // would stop a recording for a navigation that isn't one.
  it('clicking the note I am already on does not ask, and still closes the preview', async () => {
    server.use(
      http.get('/api/w/:wsId/notes/cards', () =>
        HttpResponse.json({ cards: [{ ...CARD, folderId: 'folder-1' }] }),
      ),
    )
    renderApp()
    await openNoteAndRecord()
    await userEvent.click(await screen.findByRole('button', { name: 'Preview folder notes' }))
    const panel = screen.getByTestId('folder-preview-panel')

    await userEvent.click(within(panel).getByText('Standup'))

    expect(screen.queryByTestId('confirm-leave-button')).toBeNull()
    expect(window.location.pathname).toBe(NOTE_PATH)
    // The panel still closes — the caller's side effect is not conditional on a leave.
    await waitFor(() =>
      expect(within(screen.getByTestId('folder-preview-panel')).queryByText('Standup')).toBeNull(),
    )
  })

  it('declining a folder click does not open the folder preview panel', async () => {
    renderApp()
    await openNoteAndRecord()
    await userEvent.click(await screen.findByText('Clients'))
    await screen.findByTestId('confirm-leave-button')

    await userEvent.click(screen.getByTestId('cancel-leave-button'))

    // The panel element is always in the DOM (it slides open), so assert it never took the
    // folder: its header title stays empty rather than showing "Clients".
    expect(within(screen.getByTestId('folder-preview-panel')).queryByText('Clients')).toBeNull()
    expect(window.location.pathname).toBe(NOTE_PATH)
  })

  it('switching workspace while recording asks before leaving', async () => {
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
    renderApp()
    await openNoteAndRecord()

    await userEvent.click(screen.getByTestId('workspace-switcher-trigger'))
    await userEvent.click(await screen.findByTestId('workspace-option-ws-2'))

    expect(await screen.findByTestId('confirm-leave-button')).toBeInTheDocument()
    expect(window.location.pathname).toBe(NOTE_PATH)
    // The popover stays open behind the confirm — declining must leave everything as it was.
    expect(screen.getByTestId('workspace-switcher-menu')).toBeInTheDocument()

    // And the continuation really does run: confirming lands in the other workspace.
    await userEvent.click(screen.getByTestId('confirm-leave-button'))
    await waitFor(() => expect(window.location.pathname).toBe('/w/ws-2'))
  })

  // Signing out unmounts everything, recording included.
  it('signing out while recording asks before leaving', async () => {
    renderApp()
    await openNoteAndRecord()

    await userEvent.click(screen.getByTestId('sign-out-button'))

    expect(await screen.findByTestId('confirm-leave-button')).toBeInTheDocument()
    expect(window.location.pathname).toBe(NOTE_PATH)
  })

  // Moving the note elsewhere KEEPS it — so losing the in-flight transcript is pure loss,
  // unlike delete where the note is going away anyway.
  it('moving the note to another workspace while recording asks before leaving', async () => {
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
    renderApp()
    await openNoteAndRecord()

    await userEvent.click(await screen.findByRole('button', { name: /^Move "Standup" to another workspace$/ }))
    await userEvent.click(await screen.findByTestId('move-workspace-option-ws-2'))

    expect(await screen.findByTestId('confirm-leave-button')).toBeInTheDocument()
    expect(window.location.pathname).toBe(NOTE_PATH)
  })

  // The guard must not fire when nothing is being recorded — every one of these is a
  // plain navigation the rest of the time.
  it('navigating away with no recording does not ask', async () => {
    renderApp()
    await userEvent.click(await screen.findByTestId('note-card-title'))
    await screen.findByTestId('note-title-input')

    await userEvent.click(within(screen.getByTestId('sidebar')).getByTestId('home-button'))

    await waitFor(() => expect(window.location.pathname).toBe('/w/__default__'))
    expect(screen.queryByTestId('confirm-leave-button')).toBeNull()
  })

  // The real teardown risk: a guard registered for a FINISHED recording. The case above
  // never registers one at all, so it passes either way — this one only passes if the
  // guard is actually unregistered when recording stops.
  it('navigating away after a recording has stopped does not ask', async () => {
    renderApp()
    await openNoteAndRecord()
    await userEvent.click(screen.getByTestId('mock-stop-recording'))

    await userEvent.click(within(screen.getByTestId('sidebar')).getByTestId('home-button'))

    await waitFor(() => expect(window.location.pathname).toBe('/w/__default__'))
    expect(screen.queryByTestId('confirm-leave-button')).toBeNull()
  })

  // A recording that ends on its own while the confirm is up must not strand the user:
  // the banner goes, and the destination they asked for is honoured.
  it('stopping the recording while the confirm is showing completes the navigation', async () => {
    renderApp()
    await openNoteAndRecord()
    await userEvent.click(within(screen.getByTestId('sidebar')).getByTestId('home-button'))
    await screen.findByTestId('confirm-leave-button')

    await userEvent.click(screen.getByTestId('mock-stop-recording'))

    await waitFor(() => expect(window.location.pathname).toBe('/w/__default__'))
    expect(screen.queryByTestId('confirm-leave-button')).toBeNull()
  })
})

// CHANGE-33. BUG-54 took the guarded exits from 2 to 8, but the banner said only
// "Still recording —" — so "Leave & save" could land you anywhere and you could not tell
// which of your clicks it was answering. Copy only: every guarded exit names itself.
describe('CHANGE-33 — the leave confirm names where it is about to take you', () => {
  const banner = async () => (await screen.findByTestId('leave-confirm-text')).textContent

  const TWO_WORKSPACES = http.get('/api/workspaces', () =>
    HttpResponse.json({
      workspaces: [
        { workspaceId: '__default__', name: 'Personal', isDefault: true },
        { workspaceId: 'ws-2', name: 'Work', isDefault: false },
      ],
    }),
  )

  it('names Home when I click Home', async () => {
    renderApp()
    await openNoteAndRecord()

    await userEvent.click(within(screen.getByTestId('sidebar')).getByTestId('home-button'))

    expect(await banner()).toBe('Still recording — go to Home?')
  })

  it('names the folder when I click a folder', async () => {
    renderApp()
    await openNoteAndRecord()

    await userEvent.click(await screen.findByText('Clients'))

    expect(await banner()).toBe('Still recording — go to Clients?')
  })

  it('names Unfiled when I click Unfiled', async () => {
    renderApp()
    await openNoteAndRecord()

    await userEvent.click(screen.getByTestId('unfiled-notes-button'))

    expect(await banner()).toBe('Still recording — go to Unfiled?')
  })

  it('names the workspace when I switch workspace', async () => {
    server.use(TWO_WORKSPACES)
    renderApp()
    await openNoteAndRecord()

    await userEvent.click(screen.getByTestId('workspace-switcher-trigger'))
    await userEvent.click(await screen.findByTestId('workspace-option-ws-2'))

    expect(await banner()).toBe('Still recording — switch to Work?')
  })

  it('says sign out when I sign out', async () => {
    renderApp()
    await openNoteAndRecord()

    await userEvent.click(screen.getByTestId('sign-out-button'))

    expect(await banner()).toBe('Still recording — sign out?')
  })

  it('names the workspace when I move the note to another workspace', async () => {
    server.use(TWO_WORKSPACES)
    renderApp()
    await openNoteAndRecord()

    await userEvent.click(await screen.findByRole('button', { name: /^Move "Standup" to another workspace$/ }))
    await userEvent.click(await screen.findByTestId('move-workspace-option-ws-2'))

    expect(await banner()).toBe('Still recording — move this note to Work?')
  })

  // The note's own Save/back is not routed through the guard — it confirms locally, and
  // "Leave & save" exits to the deterministic workspace home (BUG-34), so it says so.
  it('names Home for the note’s own Save button', async () => {
    renderApp()
    await openNoteAndRecord()

    await userEvent.click(screen.getByTestId('save-button'))

    expect(await banner()).toBe('Still recording — go to Home?')
  })

  // The invisible half of CHANGE-33: a second guarded click replaces the pending
  // destination (last intent wins, which is right) — the banner has to show that it did.
  it('re-names itself when a second guarded click replaces the destination', async () => {
    renderApp()
    await openNoteAndRecord()
    await userEvent.click(within(screen.getByTestId('sidebar')).getByTestId('home-button'))
    expect(await banner()).toBe('Still recording — go to Home?')

    await userEvent.click(await screen.findByText('Clients'))

    expect(await banner()).toBe('Still recording — go to Clients?')
    await userEvent.click(screen.getByTestId('confirm-leave-button'))
    await waitFor(() => expect(window.location.pathname).toBe('/w/__default__/folders/folder-1'))
  })
})
