import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { useState } from 'react'
import App from '../App'
import { AuthProvider } from '../auth/AuthContext'
import { clearToken } from '../auth/tokenStore'
import { ToastProvider } from '../components/ToastProvider'
import type { NoteRecording } from '../hooks/recordingSessionContext'
import type { TranscriptionStatus, UseTranscriptionResult } from '../hooks/useTranscription'
import { act, render, screen, waitFor, within } from '../test/render'
import { server } from '../test/setup'

// 51-C review follow-up — the leave guard must belong to the SESSION, not to whichever note
// happens to be on screen.
//
// BUG-54 guarded every exit that destroys a capture, and 51-C correctly dropped the ones that
// no longer do. But the guard itself is registered by the mounted `NoteView`, gated on THAT
// note recording — and this slice's whole purpose is to let the user be somewhere else while
// recording. From any other note, or the notes list, no guard was registered at all, so
// `requestLeave` fell straight through to `proceed()`:
//
//   - sign out  → token cleared → the unmount commit POSTs without it → 401 → transcript LOST.
//                 That is BUG-55, reproduced on this slice's headline flow.
//   - close the recording tab from a different tab → no confirm, capture orphaned.
//   - switch workspace → the session does NOT unmount (same route, no key), so the capture
//                 survives while the API client rewrites paths, and the commit goes to
//                 /w/<new>/notes/<old-id>.
//
// Every test here records in "Standup" and then LEAVES it before doing the dangerous thing, so
// none of them can be satisfied by the mounted-note guard.

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

let commitAwaited = 0
// Held open so a test can prove the sign-out WAITS, rather than merely that it asked.
let releaseCommit: (() => void) | null = null

/** Set by the mocked hook; ends the minutes-long save that follows Stop. */
let finishSaving: () => void = () => {}

vi.mock('../hooks/useTranscription', () => ({
  useTranscription: (): UseTranscriptionResult => {
    const [status, setStatus] = useState<TranscriptionStatus>('idle')
    const [transcript, setTranscript] = useState('')
    // Ends the post-Stop save on demand, from outside the note — the note's tab may well have
    // been closed by then, so there is no control on screen to drive it.
    finishSaving = () => setStatus('stopped')
    return {
      status,
      transcript,
      elapsedSeconds: 0,
      error: undefined,
      recordingUpload: 'idle',
      diarization: 'idle',
      startRecording: () => { setStatus('recording'); setTranscript('live words') },
      // 'finalising', not 'stopped' — this is the on-device shape, where the stop-time pass and
      // the speaker-labelling run for minutes before anything is committed. It matters here
      // because the note stays "still working" through that window, so its own leave guard
      // stays registered; a mock that jumps straight to 'stopped' cannot reach the paths where
      // the mounted note's guard takes over from the session's.
      stopRecording: () => setStatus('finalising'),
      awaitCommit: async () => {
        commitAwaited += 1
        await new Promise<void>((resolve) => { releaseCommit = resolve })
      },
      reset: () => { setStatus('idle'); setTranscript('') },
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

const TWO_WORKSPACES = http.get('/api/workspaces', () =>
  HttpResponse.json({
    workspaces: [
      { workspaceId: '__default__', name: 'Personal', isDefault: true },
      { workspaceId: 'ws-2', name: 'Work', isDefault: false },
    ],
  }),
)

const renderApp = () =>
  render(
    <ToastProvider>
      <AuthProvider initialToken="test-token">
        <App />
      </AuthProvider>
    </ToastProvider>,
  )

beforeEach(() => {
  // A client id must be configured or signOut() falls into no-auth mode
  // (AuthContext sets the id token to 'no-auth' when none is set) and the app never returns
  // to the sign-in screen — leaving a sign-out test with nothing to observe. Same reason, and
  // same stub, as SignOutTranscriptCommit.test.tsx.
  vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'test-client-id')
  commitAwaited = 0
  releaseCommit = null
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

afterEach(() => {
  clearToken()
  vi.unstubAllEnvs()
})

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

/** Record in "Standup", then move to "Client call" so the recording note is NOT mounted. */
async function recordInStandupThenLeaveIt() {
  await openCard('Client call')
  await userEvent.click(screen.getByTestId('open-note-tab-home'))
  await openCard('Standup')
  await userEvent.click(screen.getByTestId('mock-start-recording'))
  await waitFor(() => expect(screen.getByTestId('mock-status')).toHaveTextContent('recording'))

  await userEvent.click(within(tab('Client call')).getByTestId('open-note-tab-label'))
  await waitFor(() => expect(window.location.pathname).toBe('/w/__default__/notes/note-2'))
  // Precondition: the note that is recording is not the one on screen.
  expect(screen.getByTestId('mock-status')).toHaveTextContent('idle')
  expect(within(tab('Standup')).getByTestId('open-note-tab-recording')).toBeInTheDocument()
}

/** Record in "Standup", then go to the notes list — no note mounted at all. */
async function recordInStandupThenGoHome() {
  await openCard('Standup')
  await userEvent.click(screen.getByTestId('mock-start-recording'))
  await waitFor(() => expect(screen.getByTestId('mock-status')).toHaveTextContent('recording'))
  await userEvent.click(screen.getByTestId('open-note-tab-home'))
  await waitFor(() => expect(window.location.pathname).toBe('/w/__default__'))
  expect(screen.queryByTestId('note-title-input')).toBeNull()
}

describe('the leave guard follows the recording, not the note on screen', () => {
  it('asks before signing out while recording in another tab', async () => {
    renderApp()
    await recordInStandupThenLeaveIt()

    await userEvent.click(screen.getByTestId('sign-out-button'))

    expect(await screen.findByTestId('confirm-leave-button')).toBeInTheDocument()
    // Still signed in — the guard held the sign-out rather than letting it clear the token.
    expect(screen.queryByRole('button', { name: /sign in with google/i })).toBeNull()
  })

  it('asks before signing out while recording with no note open at all', async () => {
    renderApp()
    await recordInStandupThenGoHome()

    await userEvent.click(screen.getByTestId('sign-out-button'))

    expect(await screen.findByTestId('confirm-leave-button')).toBeInTheDocument()
  })

  // The sign-out's whole point: the token must not be cleared until the transcript has
  // landed. Asserting only that the commit was ASKED for cannot tell that apart from an
  // implementation that fires it and signs out anyway — which is the exact BUG-55 shape this
  // test is named for. So the commit is held open and the test proves nothing happens until
  // it resolves.
  it('waits for the transcript to commit before signing out', async () => {
    renderApp()
    await recordInStandupThenLeaveIt()
    await userEvent.click(screen.getByTestId('sign-out-button'))

    await userEvent.click(await screen.findByTestId('confirm-leave-button'))
    await waitFor(() => expect(commitAwaited).toBe(1))

    // Parked: still signed in, and saying so rather than looking ignored.
    expect(await screen.findByTestId('finishing-transcript')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /sign in with google/i })).toBeNull()

    // Once the save lands, the wait ends.
    expect(releaseCommit).not.toBeNull()
    releaseCommit?.()
    await waitFor(() => expect(screen.queryByTestId('finishing-transcript')).toBeNull())

    // The whole point of the wait: the sign-out completes only AFTER the save landed. This is
    // the assertion that separates "parked, then finished the job" from "parked, then did
    // nothing", so it is the one that must not be dropped.
    expect(await screen.findByRole('button', { name: /sign in with google/i })).toBeInTheDocument()
  })

  // C4 — a confirm raised on one screen must not follow you to the next.
  //
  // Nothing cleared it on navigation, and this slice is what made navigation possible while it
  // is up: the tab switches it deliberately leaves unguarded never call `clearSessionLeave`.
  // The confirm then survived to the recording note's own screen, where that note raises its
  // OWN confirm on Back — two red banners at once, each rendering `confirm-leave-button`, and
  // the stale one still holding an armed sign-out that would fire when the capture ended.
  it('drops a leave confirm when I navigate away instead of answering it', async () => {
    renderApp()
    await recordInStandupThenLeaveIt()

    await userEvent.click(screen.getByTestId('sign-out-button'))
    expect(await screen.findByTestId('confirm-leave-button')).toBeInTheDocument()

    // An unguarded navigation — the kind this slice added.
    await userEvent.click(within(tab('Standup')).getByTestId('open-note-tab-label'))
    await waitFor(() => expect(window.location.pathname).toBe('/w/__default__/notes/note-1'))

    expect(screen.queryByTestId('confirm-leave-button')).toBeNull()

    // And the sign-out it was holding is gone with it, rather than firing on its own when the
    // recording ends.
    //
    // The "still signed in" check below CANNOT carry that on its own, and a first version of
    // this test leaned on it and passed against the broken build: the armed sign-out did fire,
    // and then parked forever on the transcript commit, which this file holds open with a
    // promise it never resolves. Still signed in — for the wrong reason entirely.
    //
    // The "finishing the transcript" banner is what tells the two apart. It renders only while
    // a confirmed leave is waiting on that commit, so its ABSENCE is the proof nothing was
    // still armed. Verified by deleting the ref-clearing effect: this line goes red, the other
    // nine stay green.
    await userEvent.click(screen.getByTestId('mock-stop-recording'))
    await waitFor(() => expect(screen.getByTestId('mock-status')).toHaveTextContent('finalising'))
    await waitFor(() => expect(screen.queryByTestId('finishing-transcript')).toBeNull())
    expect(screen.queryByRole('button', { name: /sign in with google/i })).toBeNull()
  })

  // The warning must survive everything until the sign-out actually happens.
  //
  // "Finishing the transcript — we'll sign out once it's saved…" is the only thing on screen
  // saying a sign-out is still coming; the token is deliberately held until the transcript
  // lands. Standing the session's confirm down used to clear that banner too, so navigating
  // back to the recording note and closing its tab made the warning vanish while the sign-out
  // stayed armed — signed out moments later with nothing having said so.
  it('keeps saying a sign-out is coming, even if I go and do something else', async () => {
    renderApp()
    await recordInStandupThenLeaveIt()

    await userEvent.click(screen.getByTestId('sign-out-button'))
    await userEvent.click(await screen.findByTestId('confirm-leave-button'))
    await waitFor(() => expect(commitAwaited).toBe(1))
    expect(await screen.findByTestId('finishing-transcript')).toBeInTheDocument()

    // Back to the recording note and close its tab — which hands the leave to that note's own
    // guard, and used to clear the banner on the way past.
    await userEvent.click(within(tab('Standup')).getByTestId('open-note-tab-label'))
    await waitFor(() => expect(window.location.pathname).toBe('/w/__default__/notes/note-1'))
    await userEvent.click(within(tab('Standup')).getByTestId('open-note-tab-close'))

    // Still saving, still signed in, and still SAYING both.
    expect(screen.getByTestId('finishing-transcript')).toBeInTheDocument()
    // ...and nothing else. The note's own guard used to raise "Still recording — close this
    // tab?" underneath, about a meeting already stopped, beside a banner saying it was saving.
    expect(screen.queryByTestId('confirm-leave-button')).toBeNull()
    // The close itself is declined, deliberately: a leave is already under way, and the session
    // refuses every guarded exit until it lands — the same refusal that stops a second Sign out
    // click signing out before the transcript is saved. The banner is the explanation.
    expect(tab('Standup')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /sign in with google/i })).toBeNull()

    // And when the save lands, the sign-out it was warning about actually happens.
    releaseCommit?.()
    expect(await screen.findByRole('button', { name: /sign in with google/i })).toBeInTheDocument()
  })

  it('asks before closing the recording tab from a different tab', async () => {
    renderApp()
    await recordInStandupThenLeaveIt()

    await userEvent.click(within(tab('Standup')).getByTestId('open-note-tab-close'))

    expect(await screen.findByTestId('confirm-leave-button')).toBeInTheDocument()
    // Not closed yet — declining must be able to put it back.
    expect(tab('Standup')).toBeInTheDocument()
  })

  it('asks before switching workspace while recording in another tab', async () => {
    server.use(TWO_WORKSPACES)
    renderApp()
    await recordInStandupThenLeaveIt()

    await userEvent.click(screen.getByTestId('workspace-switcher-trigger'))
    await userEvent.click(await screen.findByTestId('workspace-option-ws-2'))

    expect(await screen.findByTestId('confirm-leave-button')).toBeInTheDocument()
    expect(window.location.pathname).toBe('/w/__default__/notes/note-2')
  })

  it('keeps the recording running when I decline', async () => {
    renderApp()
    await recordInStandupThenLeaveIt()
    await userEvent.click(screen.getByTestId('sign-out-button'))
    await screen.findByTestId('confirm-leave-button')

    await userEvent.click(screen.getByTestId('cancel-leave-button'))

    expect(screen.queryByTestId('confirm-leave-button')).toBeNull()
    // Still recording, still marked, and I am where I was.
    expect(within(tab('Standup')).getByTestId('open-note-tab-recording')).toBeInTheDocument()
    expect(window.location.pathname).toBe('/w/__default__/notes/note-2')
  })

  it('stops the recording when I confirm, and closes the tab I asked to close', async () => {
    renderApp()
    await recordInStandupThenLeaveIt()

    await userEvent.click(within(tab('Standup')).getByTestId('open-note-tab-close'))
    await userEvent.click(await screen.findByTestId('confirm-leave-button'))

    // The capture ended: the marker is gone from every tab.
    await waitFor(() => expect(screen.queryByTestId('open-note-tab-recording')).toBeNull())
    // AND the thing the user actually asked for happened. Asserting only the marker cannot
    // tell a working confirm from one that stops the capture and drops the request.
    await waitFor(() =>
      expect(screen.getAllByTestId('open-note-tab').some((t) => within(t).queryByText('Standup'))).toBe(false),
    )
  })

  it('names where it is about to take me', async () => {
    renderApp()
    await recordInStandupThenLeaveIt()

    await userEvent.click(screen.getByTestId('sign-out-button'))

    expect((await screen.findByTestId('leave-confirm-text')).textContent).toBe(
      'Still recording — sign out?',
    )
    expect(
      screen.getByRole('alertdialog', { name: 'Recording in progress — sign out?' }),
    ).toBeInTheDocument()
  })

  // The guard must not fire when nothing is capturing — every one of these is an ordinary
  // action the rest of the time, and a stale guard would block the app.
  it('does not ask once the recording has stopped AND finished saving', async () => {
    renderApp()
    await recordInStandupThenLeaveIt()
    // Stop it from where it is: close its tab and confirm.
    await userEvent.click(within(tab('Standup')).getByTestId('open-note-tab-close'))
    await userEvent.click(await screen.findByTestId('confirm-leave-button'))
    await waitFor(() => expect(screen.queryByTestId('open-note-tab-recording')).toBeNull())

    // Stop is not the end of the work, and until the save lands there is still something to
    // protect — the guard is deliberately still up here. The test used to end at the line
    // above and call that "stopped", which is the confusion the whole post-Stop window exists
    // to correct.
    await userEvent.click(screen.getByTestId('sign-out-button'))
    expect(await screen.findByTestId('confirm-leave-button')).toBeInTheDocument()
    await userEvent.click(screen.getByTestId('cancel-leave-button'))

    await act(async () => finishSaving())

    await userEvent.click(screen.getByTestId('sign-out-button'))
    expect(screen.queryByTestId('confirm-leave-button')).toBeNull()
  })
})
