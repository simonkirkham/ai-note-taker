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

// 51-C review finding: a meeting you glance away from was never written up.
//
// Record in one note, click another note's tab to look something up, come back, press Stop:
// the transcript saved, and the automatic write-up silently never ran. Nothing on screen said
// so — the only symptom is an analysis that never appears.
//
// Why every existing spec missed it: the two App-level recording specs both `vi.mock` the
// record control away, and the control's own specs drive idle→recording→stopped inside a
// SINGLE mount. The flag that gates the write-up lived in the control, and `NoteView` is
// `key={noteId}`, so the round trip remounted it to false. Nothing in the suite mounted the
// real control across a tab switch, so nothing could see it.
//
// So this spec mounts the REAL RecordControl and does the round trip. Only the microphone is
// faked, and the hook's state deliberately lives INSIDE the hook, so a session that did not
// survive the switch shows up as a reset transcript rather than as a passing test.

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
      // 'idle', not 'refining': with a diarization job in flight the control defers the
      // write-up to the server on purpose (33-B2), which would mask the thing being tested.
      diarization: 'idle',
      startRecording: () => {
        setStatus('recording')
        setTranscript('we agreed to ship on Friday')
      },
      stopRecording: () => setStatus('stopped'),
      awaitCommit: async () => {},
      reset: () => {
        setStatus('idle')
        setTranscript('')
      },
    }
  },
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

/** Every note the write-up was requested for, in order. */
let analysed: string[] = []
/** Makes the next write-up request fail, once. */
let failNextAnalyse = false

const renderApp = () =>
  render(
    <ToastProvider>
      <AuthProvider initialToken="test-token">
        <App />
      </AuthProvider>
    </ToastProvider>,
  )

beforeEach(() => {
  analysed = []
  failNextAnalyse = false
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
    http.post('/api/w/:wsId/notes/:noteId/analyse', ({ params }) => {
      analysed.push(String(params.noteId))
      if (failNextAnalyse) {
        failNextAnalyse = false
        return new HttpResponse(null, { status: 500 })
      }
      return new HttpResponse(null, { status: 204 })
    }),
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

const openTab = (title: string) =>
  userEvent.click(within(tab(title)).getByTestId('open-note-tab-label'))

/** Both notes open, recording under way in Standup, with the real record control mounted. */
async function recordInStandup() {
  await openCard('Client call')
  await userEvent.click(screen.getByTestId('open-note-tab-home'))
  await openCard('Standup')
  await userEvent.click(screen.getByTestId('transcription-record-button'))
  await screen.findByTestId('transcription-timer')
}

describe('51-C — the write-up still runs after looking at another note', () => {
  it('writes the meeting up when I stop, even though I read another note mid-recording', async () => {
    renderApp()
    await recordInStandup()

    await openTab('Client call')
    await openTab('Standup')

    // The session survived the round trip — this is the precondition, not the assertion. If it
    // had not, there would be nothing to write up and the real failure would be hidden.
    expect(await screen.findByTestId('transcription-timer')).toBeInTheDocument()

    await userEvent.click(screen.getByTestId('transcription-stop-button'))

    await waitFor(() => expect(analysed).toEqual(['note-1']))
  })

  it('writes it up exactly once, however many times I switch tabs after stopping', async () => {
    renderApp()
    await recordInStandup()
    await userEvent.click(screen.getByTestId('transcription-stop-button'))
    await waitFor(() => expect(analysed).toEqual(['note-1']))

    // The mirror-image bug: the one-shot latch lived in the control too, so a remount after
    // Stop would let the same recording be written up again — costing money and overwriting
    // the note a second time.
    await openTab('Client call')
    await openTab('Standup')
    await openTab('Client call')
    await openTab('Standup')

    await waitFor(() => expect(screen.getByTestId('record-control')).toBeInTheDocument())
    expect(analysed).toEqual(['note-1'])
  })

  // The one-shot claim is taken BEFORE the request goes out, so a write-up that fails has to
  // hand it back or it can never be retried — the error message is local to the control and
  // dies with the next tab switch, leaving the meeting un-analysed and nothing saying so.
  it('can try again when the automatic write-up fails', async () => {
    renderApp()
    failNextAnalyse = true
    await recordInStandup()
    await userEvent.click(screen.getByTestId('transcription-stop-button'))
    await waitFor(() => expect(analysed).toEqual(['note-1']))
    expect(await screen.findByTestId('transcription-analyse-error')).toBeInTheDocument()

    await openTab('Client call')
    await openTab('Standup')

    await waitFor(() => expect(analysed).toEqual(['note-1', 'note-1']))
  })

  // The mirror of that: handing the claim back is only ever right for the AUTOMATIC path. The
  // manual Analyse button shares the same code, and a manual failure releasing a claim it never
  // took wrote the meeting up a second time — over the top of a summary that had already
  // succeeded. Three requests where there should be two.
  it('does not write it up again when a manual retry fails after a successful one', async () => {
    renderApp()
    await recordInStandup()
    await userEvent.click(screen.getByTestId('transcription-stop-button'))
    await waitFor(() => expect(analysed).toEqual(['note-1']))

    failNextAnalyse = true
    await userEvent.click(screen.getByTestId('transcription-analyse-button'))
    await waitFor(() => expect(analysed).toEqual(['note-1', 'note-1']))
    expect(await screen.findByTestId('transcription-analyse-error')).toBeInTheDocument()

    await openTab('Client call')
    await openTab('Standup')

    await waitFor(() => expect(screen.getByTestId('record-control')).toBeInTheDocument())
    expect(analysed).toEqual(['note-1', 'note-1'])
  })

  it('does not write it up when I turned the automatic write-up off before recording', async () => {
    renderApp()
    await openCard('Client call')
    await userEvent.click(screen.getByTestId('open-note-tab-home'))
    await openCard('Standup')

    // The toggle is hidden while recording precisely so it cannot change — but the control
    // remounts back to its default on a tab switch, which would quietly undo the choice.
    await userEvent.click(screen.getByTestId('transcription-auto-analyse-toggle'))
    await userEvent.click(screen.getByTestId('transcription-record-button'))
    await screen.findByTestId('transcription-timer')

    await openTab('Client call')
    await openTab('Standup')
    await userEvent.click(screen.getByTestId('transcription-stop-button'))

    await waitFor(() => expect(screen.getByTestId('transcription-analyse-button')).toBeInTheDocument())
    expect(analysed).toEqual([])
  })
})
