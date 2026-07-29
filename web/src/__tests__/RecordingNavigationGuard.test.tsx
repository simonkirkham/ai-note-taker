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
    <button data-testid="mock-start-recording" onClick={() => transcription.startRecording(true, true)}>
      Start recording
    </button>
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

/** Open the note and start recording in it. */
async function openNoteAndRecord() {
  await userEvent.click(await screen.findByTestId('note-card-title'))
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
})
