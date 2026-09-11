import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { useState } from 'react'
import App from '../App'
import { AuthProvider } from '../auth/AuthContext'
import { clearToken } from '../auth/tokenStore'
import { ToastProvider } from '../components/ToastProvider'
import type { NoteRecording } from '../hooks/recordingSessionContext'
import type { TranscriptionStatus, UseTranscriptionResult } from '../hooks/useTranscription'
import { render, screen, waitFor, within } from '../test/render'
import { server } from '../test/setup'

// 51-C: a recording keeps running while you read another note.
//
// Until now the transcription session lived inside the mounted NoteView, so switching tabs
// unmounted it and killed the capture — which is why 49-A wrapped the tab switch in a
// leave-confirm (BUG-54's class of failure). This slice hoists the session above the note,
// so the switch neither prompts nor stops anything.
//
// The mock below is deliberately stateful IN THE HOOK, exactly like the other recording
// specs: `useState` inside `useTranscription`. That is what makes these tests honest. If the
// hook is still called from NoteView, leaving the note unmounts it and the transcript resets
// to '' — so "the transcript is still there when I come back" can only pass once the session
// genuinely lives above the note. No assertion here inspects the implementation; the survival
// of the transcript IS the proof.
//
// What vitest CANNOT prove is that audio kept flowing — no mic in jsdom. That is the E2E's
// job (Batch 2). Here we prove the session is not torn down, which is the failure mode.

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

// Set by the mocked hook so a test can end the background save on demand.
let finishUpload: () => void = () => {}

vi.mock('../hooks/useTranscription', () => ({
  useTranscription: (): UseTranscriptionResult => {
    const [status, setStatus] = useState<TranscriptionStatus>('idle')
    const [transcript, setTranscript] = useState('')
    const [upload, setUpload] = useState<'idle' | 'uploading' | 'uploaded' | 'failed'>('idle')
    finishUpload = () => setUpload('uploaded')
    return {
      status,
      transcript,
      elapsedSeconds: 0,
      error: undefined,
      recordingUpload: upload,
      diarization: 'idle',
      startRecording: () => {
        setStatus('recording')
        setTranscript('live words')
        setUpload('idle')
      },
      // Stop does NOT mean finished: the audio upload and the speaker-labelling run on
      // afterwards, for minutes on a long meeting. Modelling that is the whole point here.
      stopRecording: () => {
        setStatus('stopped')
        setUpload('uploading')
      },
      awaitCommit: async () => {},
      reset: () => {
        setStatus('idle')
        setTranscript('')
      },
    }
  },
}))

// Renders the live transcript so a test can see whether it survived, plus the two controls
// and the single-recorder flag the real control uses to disable itself.
vi.mock('../components/RecordControl', () => ({
  default: ({ transcription }: { transcription: NoteRecording }) => (
    <>
      <button data-testid="mock-start-recording" onClick={() => transcription.startRecording(true, true)}>
        Start recording
      </button>
      <button data-testid="mock-stop-recording" onClick={() => transcription.stopRecording()}>
        Stop recording
      </button>
      <div data-testid="mock-status">{transcription.status}</div>
      <div data-testid="mock-transcript">{transcription.transcript}</div>
      <div data-testid="mock-other-recording">{String(transcription.otherNoteRecording ?? false)}</div>
      <div data-testid="mock-upload">{transcription.recordingUpload}</div>
    </>
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
    http.get('/api/w/:wsId/notes/cards', () => HttpResponse.json({ cards: [STANDUP, CLIENT_CALL] })),
    http.get('/api/w/:wsId/folders', () => HttpResponse.json({ folders: [FOLDER] })),
    http.get('/api/w/:wsId/notes/:noteId', ({ params }) =>
      HttpResponse.json({
        noteId: params.noteId,
        title: params.noteId === 'note-1' ? 'Standup' : 'Client call',
        content: '',
        date: today,
        tags: [],
        transcriptIsDiarized: false,
      }),
    ),
  )
})

afterEach(() => clearToken())

async function openCard(title: string) {
  const cards = await screen.findAllByTestId('note-card')
  const found = cards.find((c) => within(c).queryByText(title))
  if (!found) throw new Error(`no card titled ${title}`)
  await userEvent.click(within(found).getByTestId('note-card-title'))
  await screen.findByTestId('note-title-input')
}

function tab(title: string) {
  const tabs = screen.getAllByTestId('open-note-tab')
  const found = tabs.find((t) => within(t).queryByText(title))
  if (!found) throw new Error(`no tab titled ${title}`)
  return found
}

/** Open both notes so the bar has two tabs, then record in "Standup". */
async function openBothAndRecordInStandup() {
  await openCard('Client call')
  await userEvent.click(screen.getByTestId('open-note-tab-home'))
  await openCard('Standup')
  await userEvent.click(screen.getByTestId('mock-start-recording'))
  await waitFor(() => expect(screen.getByTestId('mock-status')).toHaveTextContent('recording'))
}

describe('51-C — a recording keeps running while I read another note', () => {
  it('switching to another tab does not ask me to confirm', async () => {
    renderApp()
    await openBothAndRecordInStandup()

    await userEvent.click(within(tab('Client call')).getByTestId('open-note-tab-label'))

    expect(screen.queryByTestId('confirm-leave-button')).toBeNull()
    await waitFor(() => expect(window.location.pathname).toBe('/w/__default__/notes/note-2'))
  })

  it('the live transcript is still there when I come back', async () => {
    renderApp()
    await openBothAndRecordInStandup()

    await userEvent.click(within(tab('Client call')).getByTestId('open-note-tab-label'))
    await waitFor(() => expect(window.location.pathname).toBe('/w/__default__/notes/note-2'))
    await userEvent.click(within(tab('Standup')).getByTestId('open-note-tab-label'))
    await waitFor(() => expect(window.location.pathname).toBe('/w/__default__/notes/note-1'))

    expect(screen.getByTestId('mock-transcript')).toHaveTextContent('live words')
    expect(screen.getByTestId('mock-status')).toHaveTextContent('recording')
  })

  it('the recording note is marked in the bar, from another note', async () => {
    renderApp()
    await openBothAndRecordInStandup()
    await userEvent.click(within(tab('Client call')).getByTestId('open-note-tab-label'))
    await waitFor(() => expect(window.location.pathname).toBe('/w/__default__/notes/note-2'))

    // Readable while standing in the OTHER note — the marker's whole purpose is telling you
    // which note is live when that note is not the one on screen.
    const marker = within(tab('Standup')).getByTestId('open-note-tab-recording')
    expect(marker).toBeInTheDocument()
    expect(within(tab('Standup')).getByTestId('open-note-tab-label')).toHaveAccessibleName(
      /recording/i,
    )
    expect(within(tab('Client call')).queryByTestId('open-note-tab-recording')).toBeNull()
  })

  it('a second note cannot start its own recording while one is live', async () => {
    renderApp()
    await openBothAndRecordInStandup()
    await userEvent.click(within(tab('Client call')).getByTestId('open-note-tab-label'))
    await waitFor(() => expect(window.location.pathname).toBe('/w/__default__/notes/note-2'))

    // The other note sees an idle session, so its own control offers nothing to start.
    expect(screen.getByTestId('mock-status')).toHaveTextContent('idle')
    expect(screen.getByTestId('mock-other-recording')).toHaveTextContent('true')

    await userEvent.click(screen.getByTestId('mock-start-recording'))

    // Refused: the claim stays with Standup and Client call is still idle.
    expect(screen.getByTestId('mock-status')).toHaveTextContent('idle')
    expect(within(tab('Standup')).getByTestId('open-note-tab-recording')).toBeInTheDocument()
    expect(within(tab('Client call')).queryByTestId('open-note-tab-recording')).toBeNull()
  })

  // The three navigations the phase doc left conditional: drop the prompt ONLY IF the
  // recording provably survives the route change. These are that proof — each one leaves the
  // note entirely (no NoteView mounted at all), then comes back and reads the transcript. If
  // the session were still owned by the note, every one of these would come back to ''.
  //
  // The marker assertion is the second half of the case: from a screen with no note on it,
  // the tab bar is the ONLY thing telling you a recording is still running. Dropping the
  // prompt without it would leave a capture live with nothing on screen saying so.
  it.each([
    ['my notes list', () => userEvent.click(screen.getByTestId('open-note-tab-home')), '/w/__default__'],
    ['a folder', async () => { await userEvent.click(await screen.findByText('Clients')) }, '/w/__default__/folders/folder-1'],
    ['Unfiled', () => userEvent.click(screen.getByTestId('unfiled-notes-button')), '/w/__default__/folders/unfiled'],
  ])('going to %s does not ask, and the recording is still running when I come back', async (_where, go, path) => {
    renderApp()
    await openBothAndRecordInStandup()

    await go()

    expect(screen.queryByTestId('confirm-leave-button')).toBeNull()
    await waitFor(() => expect(window.location.pathname).toBe(path))
    // Still visibly recording, with no note on screen to say so.
    expect(within(tab('Standup')).getByTestId('open-note-tab-recording')).toBeInTheDocument()

    await userEvent.click(within(tab('Standup')).getByTestId('open-note-tab-label'))
    await waitFor(() => expect(window.location.pathname).toBe('/w/__default__/notes/note-1'))
    expect(screen.getByTestId('mock-transcript')).toHaveTextContent('live words')
    expect(screen.getByTestId('mock-status')).toHaveTextContent('recording')
  })

  // Everything below the Stop button. Review found the slice shipped with NO coverage past
  // Stop, and two defects were living in exactly that gap: the app was recordable ONCE per
  // page load, and re-recording the same note did nothing at all. Both passed every spec
  // above, because every spec above stops at "it is recording".
  describe('after a recording stops', () => {
    // Stop is not the end. The audio upload and the speaker-labelling keep running, and they
    // read shared settings across each pause — so a second note starting mid-chain overwrites
    // the first one's, and the first meeting silently loses its automatic write-up. Waiting
    // makes that impossible rather than handled.
    it('will not let another note record while the last one is still saving', async () => {
      renderApp()
      await openBothAndRecordInStandup()
      await userEvent.click(screen.getByTestId('mock-stop-recording'))

      await userEvent.click(within(tab('Client call')).getByTestId('open-note-tab-label'))
      await waitFor(() => expect(window.location.pathname).toBe('/w/__default__/notes/note-2'))

      expect(screen.getByTestId('mock-other-recording')).toHaveTextContent('true')
      await userEvent.click(screen.getByTestId('mock-start-recording'))

      expect(screen.getByTestId('mock-status')).toHaveTextContent('idle')
      expect(screen.queryByTestId('open-note-tab-recording')).toBeNull()
    })

    it('lets another note record once the save has finished', async () => {
      renderApp()
      await openBothAndRecordInStandup()
      await userEvent.click(screen.getByTestId('mock-stop-recording'))
      await userEvent.click(within(tab('Client call')).getByTestId('open-note-tab-label'))
      await waitFor(() => expect(window.location.pathname).toBe('/w/__default__/notes/note-2'))

      finishUpload()

      await waitFor(() =>
        expect(screen.getByTestId('mock-other-recording')).toHaveTextContent('false'),
      )
      await userEvent.click(screen.getByTestId('mock-start-recording'))
      await waitFor(() => expect(screen.getByTestId('mock-status')).toHaveTextContent('recording'))
      expect(within(tab('Client call')).getByTestId('open-note-tab-recording')).toBeInTheDocument()
    })

    it('takes the marker off the tab', async () => {
      renderApp()
      await openBothAndRecordInStandup()
      expect(within(tab('Standup')).getByTestId('open-note-tab-recording')).toBeInTheDocument()

      await userEvent.click(screen.getByTestId('mock-stop-recording'))

      await waitFor(() =>
        expect(within(tab('Standup')).queryByTestId('open-note-tab-recording')).toBeNull(),
      )
    })

    // The Continue / Re-record path from 18-C. The claim already sits on this note, so the
    // start cannot rely on the bound id CHANGING to trigger it — a same-value setState is a
    // no-op and the request never fires.
    it('lets the same note record again', async () => {
      renderApp()
      await openBothAndRecordInStandup()
      await userEvent.click(screen.getByTestId('mock-stop-recording'))
      await waitFor(() => expect(screen.getByTestId('mock-status')).toHaveTextContent('stopped'))

      await userEvent.click(screen.getByTestId('mock-start-recording'))

      await waitFor(() => expect(screen.getByTestId('mock-status')).toHaveTextContent('recording'))
    })

    // The note that stopped keeps its own session view while the transcript commits and the
    // recording uploads — it must not be handed the idle view the moment capture ends.
    it('leaves the stopped note still seeing its own session', async () => {
      renderApp()
      await openBothAndRecordInStandup()
      await userEvent.click(screen.getByTestId('mock-stop-recording'))

      expect(screen.getByTestId('mock-status')).toHaveTextContent('stopped')
      expect(screen.getByTestId('mock-transcript')).toHaveTextContent('live words')
    })
  })

  // The guard that must NOT be dropped. Closing the tab destroys the note that is capturing,
  // so this keeps BUG-54's protection exactly where it still applies.
  it('closing the recording tab still asks first', async () => {
    renderApp()
    await openBothAndRecordInStandup()

    await userEvent.click(within(tab('Standup')).getByTestId('open-note-tab-close'))

    expect(await screen.findByTestId('confirm-leave-button')).toBeInTheDocument()
    expect(window.location.pathname).toBe('/w/__default__/notes/note-1')
  })
})
