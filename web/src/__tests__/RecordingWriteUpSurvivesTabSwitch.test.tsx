import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { useState } from 'react'
import App from '../App'
import { AuthProvider } from '../auth/AuthContext'
import { clearToken } from '../auth/tokenStore'
import { ToastProvider } from '../components/ToastProvider'
import type { TranscriptionStatus, UseTranscriptionResult } from '../hooks/useTranscription'
import { act, render, screen, waitFor, within } from '../test/render'
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

/** When set, Stop takes the on-device shape: 'finalising' for minutes, until `finishSaving`. */
let slowStop = false
/** Set by the mocked hook; ends that save from outside any note. */
let finishSaving: () => void = () => {}

vi.mock('../hooks/useTranscription', () => ({
  useTranscription: (): UseTranscriptionResult => {
    const [status, setStatus] = useState<TranscriptionStatus>('idle')
    const [transcript, setTranscript] = useState('')
    finishSaving = () => setStatus('stopped')
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
      stopRecording: () => setStatus(slowStop ? 'finalising' : 'stopped'),
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
  slowStop = false
  window.history.replaceState({}, '', '/')
  server.use(
    http.get('/api/w/:wsId/notes/cards', () => HttpResponse.json({ cards: [STANDUP, CLIENT_CALL] })),
    http.get('/api/w/:wsId/folders', () => HttpResponse.json({ folders: [] })),
    http.get('/api/w/:wsId/notes/:noteId', ({ params }) =>
      HttpResponse.json({
        noteId: params.noteId,
        title: params.noteId === 'note-1' ? 'Standup' : 'Client call',
        // Client call has notes of its own, so its Analyse button is live — the button the
        // write-up must not be confused with.
        content: params.noteId === 'note-2' ? 'agenda: renewal terms' : '',
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

  // A failed write-up must stay SAID. Before the write-up belonged to the recording, its error
  // lived in the record control and died with the next tab switch, so the meeting was left
  // un-analysed with nothing on screen saying so — and the workaround was to silently re-run it
  // on the way back. Now the failure outlives the switch, and the Analyse button it points at is
  // the remedy.
  it('still tells me the write-up failed after I look at another note, and Analyse fixes it', async () => {
    renderApp()
    failNextAnalyse = true
    await recordInStandup()
    await userEvent.click(screen.getByTestId('transcription-stop-button'))
    await waitFor(() => expect(analysed).toEqual(['note-1']))
    expect(await screen.findByTestId('transcription-analyse-error')).toBeInTheDocument()

    await openTab('Client call')
    // The failure belongs to Standup, not to whatever note is on screen.
    expect(screen.queryByTestId('transcription-analyse-error')).toBeNull()
    await openTab('Standup')

    expect(await screen.findByTestId('transcription-analyse-error')).toBeInTheDocument()
    expect(analysed).toEqual(['note-1'])

    await userEvent.click(screen.getByTestId('transcription-analyse-button'))
    await waitFor(() => expect(analysed).toEqual(['note-1', 'note-1']))
    await waitFor(() => expect(screen.queryByTestId('transcription-analyse-error')).toBeNull())

    // Fixed means fixed: the error does not come back, and nothing re-runs, on the next glance.
    await openTab('Client call')
    await openTab('Standup')
    await waitFor(() => expect(screen.getByTestId('record-control')).toBeInTheDocument())
    expect(screen.queryByTestId('transcription-analyse-error')).toBeNull()
    expect(analysed).toEqual(['note-1', 'note-1'])
  })

  // The app's own remedy path: the automatic write-up fails, the error message invites you to
  // press Analyse, you do, and it works. An earlier version wrote the meeting up a third time on
  // the next glance at another note — over the summary just produced.
  it('does not write it up again after I fix a failed write-up with the Analyse button', async () => {
    renderApp()
    failNextAnalyse = true
    await recordInStandup()
    await userEvent.click(screen.getByTestId('transcription-stop-button'))
    await waitFor(() => expect(analysed).toEqual(['note-1']))
    expect(await screen.findByTestId('transcription-analyse-error')).toBeInTheDocument()

    await userEvent.click(screen.getByTestId('transcription-analyse-button'))
    await waitFor(() => expect(analysed).toEqual(['note-1', 'note-1']))
    await waitFor(() => expect(screen.queryByTestId('transcription-analyse-error')).toBeNull())

    await openTab('Client call')
    await openTab('Standup')

    await waitFor(() => expect(screen.getByTestId('record-control')).toBeInTheDocument())
    expect(analysed).toEqual(['note-1', 'note-1'])
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

  // Round-5 review: analysing a DIFFERENT note mid-meeting took the meeting's write-up. The one
  // write-up a recording is owed was a single app-wide flag, and any successful Analyse took it.
  it('still writes the meeting up after I analyse a different note mid-recording', async () => {
    renderApp()
    await recordInStandup()

    await openTab('Client call')
    await userEvent.click(screen.getByTestId('transcription-analyse-button'))
    await waitFor(() => expect(analysed).toEqual(['note-2']))

    await openTab('Standup')
    await userEvent.click(screen.getByTestId('transcription-stop-button'))

    await waitFor(() => expect(analysed).toEqual(['note-2', 'note-1']))
  })

  // Round-5 review: on-device, Stop is followed by minutes of saving. Reading another note
  // through that window meant the write-up waited for you to come back — and starting a
  // recording in the other note first erased it for good. The write-up belongs to the meeting,
  // so it runs when the meeting has finished saving, wherever you are.
  it('writes the meeting up when it finishes saving, even if I am reading another note', async () => {
    renderApp()
    slowStop = true
    await recordInStandup()
    await userEvent.click(screen.getByTestId('transcription-stop-button'))
    await screen.findByTestId('transcription-finalising')

    await openTab('Client call')
    act(() => finishSaving())

    await waitFor(() => expect(analysed).toEqual(['note-1']))

    // And recording the next meeting straight away writes THAT one up too, without re-running
    // the first.
    slowStop = false
    await userEvent.click(screen.getByTestId('transcription-record-button'))
    await screen.findByTestId('transcription-timer')
    await userEvent.click(screen.getByTestId('transcription-stop-button'))

    await waitFor(() => expect(analysed).toEqual(['note-1', 'note-2']))
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
