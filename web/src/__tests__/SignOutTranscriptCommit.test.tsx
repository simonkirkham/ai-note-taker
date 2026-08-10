import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { useState } from 'react'
import App from '../App'
import { AuthProvider } from '../auth/AuthContext'
import { ToastProvider } from '../components/ToastProvider'
import type { TranscriptionStatus, UseTranscriptionResult } from '../hooks/useTranscription'
import { render, screen, waitFor, within } from '../test/render'
import { server } from '../test/setup'

// BUG-55: [BUG-54]'s leave-confirm awaits the CONTENT save before proceeding, but the TRANSCRIPT
// commit is fired asynchronously by stopRecording(). In cloud mode it dispatches immediately, so it
// outlives a route change. In LOCAL mode it first runs the stop-time medium.en pass plus 1:1
// diarization — minutes on a long meeting — and only then issues an authenticated POST. Sign-out
// clears the token long before that, so the POST 401s, `committedRef` is released, and nothing
// retries: the transcript is silently lost.
//
// Sign-out is the only continuation that clears auth, which is why it is the only one that waits.
// Awaiting on every destination would hang ordinary navigation for those same minutes — so the test
// pins BOTH halves: sign-out waits, and a plain navigation does not.

let resolveCommit: (() => void) | undefined
let commitAwaited = 0

vi.mock('../components/LazyNoteEditor', () => ({
  default: () => <textarea aria-label="Note content" data-testid="note-content" />,
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
      // 'finalising', not 'stopped' — that is what LOCAL mode does, and it is load-bearing here:
      // `isRecording` includes 'finalising', so the leave guard stays registered during the park.
      // With 'stopped' the guard unregisters and a second sign-out click bypasses it entirely,
      // which would make the dead-banner test pass for the wrong reason.
      stopRecording: () => setStatus('finalising'),
      // Stands in for the local-mode finalise: resolves only when the test says so, which is what
      // makes "did the continuation wait?" observable rather than a matter of timing.
      awaitCommit: () => {
        commitAwaited += 1
        return new Promise<void>((resolve) => {
          resolveCommit = resolve
        })
      },
      reset: () => {
        setStatus('idle')
        setTranscript('')
      },
    }
  },
}))

vi.mock('../components/RecordControl', () => ({
  default: ({ transcription }: { transcription: UseTranscriptionResult }) => (
    <button
      data-testid="mock-start-recording"
      onClick={() => transcription.startRecording(true, true)}
    >
      Start recording
    </button>
  ),
}))

const now = new Date().toISOString()
const today = now.slice(0, 10)

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
  // A client id must be configured or signOut() falls into no-auth mode (`setIdToken('no-auth')`)
  // and the gate never returns to the sign-in screen — leaving the test with nothing to observe.
  vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'test-client-id')
  resolveCommit = undefined
  commitAwaited = 0
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

afterEach(() => vi.unstubAllEnvs())

async function openNoteAndRecord() {
  const cards = await screen.findAllByTestId('note-card')
  const card = cards.find((c) => within(c).queryByText('Standup'))
  if (!card) throw new Error('no Standup card')
  await userEvent.click(within(card).getByTestId('note-card-title'))
  await screen.findByTestId('note-title-input')
  await userEvent.click(screen.getByTestId('mock-start-recording'))
}

describe('signing out mid-recording (BUG-55)', () => {
  it('does not sign out until the transcript commit has landed', async () => {
    renderApp()
    await openNoteAndRecord()

    await userEvent.click(screen.getByTestId('sign-out-button'))
    await screen.findByTestId('confirm-leave-button')
    await userEvent.click(screen.getByTestId('confirm-leave-button'))

    // The continuation is now parked on the commit. Sign-out has NOT happened: the note screen is
    // still mounted and the sign-in page has not replaced it.
    await waitFor(() => expect(commitAwaited).toBe(1))
    expect(screen.queryByRole('button', { name: /sign in with google/i })).toBeNull()
    expect(screen.getByTestId('note-title-input')).toBeInTheDocument()
    // ...and the wait is VISIBLE. Without this the click looks ignored for minutes.
    expect(screen.getByTestId('finishing-transcript')).toBeInTheDocument()

    resolveCommit?.()

    // Only once the commit resolves does the token get cleared and the gate fall back to sign-in.
    expect(await screen.findByRole('button', { name: /sign in with google/i })).toBeInTheDocument()
  })

  it('does not make ordinary navigation wait for the finalise', async () => {
    // The reason this is opt-in per destination: in local mode awaitCommit takes minutes, and every
    // other destination is already safe because the request outlives a route change.
    renderApp()
    await openNoteAndRecord()

    await userEvent.click(within(screen.getByTestId('sidebar')).getByTestId('home-button'))
    await userEvent.click(await screen.findByTestId('confirm-leave-button'))

    // Left the note without the commit ever being awaited — no hang.
    await waitFor(() => expect(screen.queryByTestId('note-title-input')).toBeNull())
    expect(commitAwaited).toBe(0)
  })

  // Review of the previous round: the parked-state UI was added in response to a finding and then
  // had no test — the same defect class, in the fix for it. During the park `isRecording` is still
  // true, so the guard stays registered and a second click re-raised a confirm whose button now
  // returns immediately, leaving a dead banner on screen for the whole finalise.
  it('does not leave a dead confirm banner when the leave is clicked again mid-wait', async () => {
    renderApp()
    await openNoteAndRecord()

    await userEvent.click(screen.getByTestId('sign-out-button'))
    await userEvent.click(await screen.findByTestId('confirm-leave-button'))
    await waitFor(() => expect(commitAwaited).toBe(1))

    // Click sign out again while parked, then confirm again.
    await userEvent.click(screen.getByTestId('sign-out-button'))
    const secondConfirm = screen.queryByTestId('confirm-leave-button')
    if (secondConfirm) await userEvent.click(secondConfirm)

    await waitFor(() => expect(screen.queryByTestId('confirm-leave-button')).toBeNull())
    expect(screen.getByTestId('finishing-transcript')).toBeInTheDocument()

    resolveCommit?.()
    expect(await screen.findByRole('button', { name: /sign in with google/i })).toBeInTheDocument()
  })
})
