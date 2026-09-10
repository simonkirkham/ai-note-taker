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

// 51-C review finding: the minutes AFTER Stop, which nothing in the suite reached.
//
// Pressing Stop does not finish the work. The transcript commit, the audio upload and the
// speaker-labelling run on afterwards — minutes of it when the transcription happens on this
// machine. Two opposite things were both wrong in that window, and no spec could tell either:
//
//   - Treating it as still recording: the tab pulsed red and screen readers announced
//     ", recording" about a meeting the user had already stopped, and every other note was told
//     "Another note is recording — stop it first" about a recording that could not be stopped.
//   - Treating it as finished: the tab lost its marker entirely and closing it stopped asking —
//     and that tab is the only handle on a note still being written.
//
// So the marker follows the LIVE capture and everything that protects the note follows the whole
// busy period. This file is what stops either half being quietly reverted: the fix to the first
// was made once with no spec at all, and the entire suite stayed green when it was undone.

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
      startRecording: () => {
        setStatus('recording')
        setTranscript('live words')
      },
      // 'finalising', not 'stopped': this is the on-device shape, where the stop-time pass and
      // the speaker-labelling run before anything is committed. It is the long window.
      stopRecording: () => setStatus('finalising'),
      awaitCommit: async () => {},
      reset: () => setStatus('idle'),
    }
  },
}))

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
      <div data-testid="mock-other-busy">{transcription.otherNoteBusyReason ?? 'none'}</div>
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
    http.get('/api/w/:wsId/folders', () => HttpResponse.json({ folders: [] })),
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

/** Record in Standup, stop it, then move to Client call — Standup is now saving, off screen. */
async function stopInStandupThenLeaveIt() {
  await openCard('Client call')
  await userEvent.click(screen.getByTestId('open-note-tab-home'))
  await openCard('Standup')
  await userEvent.click(screen.getByTestId('mock-start-recording'))
  await waitFor(() => expect(screen.getByTestId('mock-status')).toHaveTextContent('recording'))
  await userEvent.click(screen.getByTestId('mock-stop-recording'))
  await waitFor(() => expect(screen.getByTestId('mock-status')).toHaveTextContent('finalising'))

  await userEvent.click(within(tab('Client call')).getByTestId('open-note-tab-label'))
  await waitFor(() => expect(window.location.pathname).toBe('/w/__default__/notes/note-2'))
}

describe('51-C — the minutes after Stop, while the meeting is still being saved', () => {
  it('stops claiming the meeting is recording, and says it is saving instead', async () => {
    renderApp()
    await stopInStandupThenLeaveIt()

    const standup = tab('Standup')
    expect(within(standup).queryByTestId('open-note-tab-recording')).toBeNull()
    expect(within(standup).getByTestId('open-note-tab-saving')).toBeInTheDocument()
    // Colour is never the only channel — the marker has a spoken counterpart, and it must not
    // be the word "recording".
    expect(standup).toHaveTextContent(/, saving/)
    expect(standup).not.toHaveTextContent(/, recording/)
  })

  it('tells the other note it is waiting on a save, not on a recording it could stop', async () => {
    renderApp()
    await stopInStandupThenLeaveIt()

    expect(screen.getByTestId('mock-other-busy')).toHaveTextContent('saving')
  })

  it('still asks before closing the tab of a meeting that is only part-saved', async () => {
    renderApp()
    await stopInStandupThenLeaveIt()

    // From the OTHER note's screen — the position this slice created, and the one where the
    // guard used to fall through.
    await userEvent.click(within(tab('Standup')).getByTestId('open-note-tab-close'))

    expect(await screen.findByTestId('confirm-leave-button')).toBeInTheDocument()
    // Not closed behind the confirm — the tab is still there to answer for.
    expect(tab('Standup')).toBeInTheDocument()
  })

  // The other half of the pair, and the one that pins the actual property. Without it the test
  // above passes for a much weaker reason: it cannot tell "guarded because THIS note is busy"
  // from "guarded because SOMETHING is busy" — which is what the code did, and which turned an
  // unrelated tab close into "Still recording — close this tab?" over a meeting the user had
  // never referred to. Confirming that stopped it.
  it('does not ask when I close an unrelated tab, and leaves the other meeting alone', async () => {
    renderApp()
    await stopInStandupThenLeaveIt()

    // Client call is on screen and has nothing to do with the meeting saving in Standup.
    await userEvent.click(within(tab('Client call')).getByTestId('open-note-tab-close'))

    await waitFor(() => expect(screen.queryByText('Client call')).toBeNull())
    expect(screen.queryByTestId('confirm-leave-button')).toBeNull()
    // And the meeting is untouched — still saving, still marked.
    expect(within(tab('Standup')).getByTestId('open-note-tab-saving')).toBeInTheDocument()
  })
})
