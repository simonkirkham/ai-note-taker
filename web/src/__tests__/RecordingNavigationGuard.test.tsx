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
//
// 51-C narrowed which exits are still dangerous. The session no longer belongs to the
// mounted note, so a route change inside the workspace — the notes list, a folder, Unfiled,
// another note — keeps the capture running and is no longer guarded; the proof that it
// really survives (leave, come back, read the transcript) is RecordingSurvivesTabSwitch,
// and it is not duplicated here. What remains below is the set that still DESTROYS a
// capture: closing the recording tab, sign-out, a workspace switch, moving the note, and
// leaving the browser.

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
      awaitCommit: async () => {},
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
  // Closing the tab is the exit 51-C keeps and the one it is most tempting to lose, since it
  // sits next to the tab SWITCH that the slice deliberately unguarded. It carries the
  // decline/confirm coverage that used to hang off the Home button.
  it('closing the recording tab asks before leaving', async () => {
    renderApp()
    await openNoteAndRecord()

    await userEvent.click(screen.getByTestId('open-note-tab-close'))

    expect(await screen.findByTestId('confirm-leave-button')).toBeInTheDocument()
    expect(window.location.pathname).toBe(NOTE_PATH)
  })

  it('declining keeps me on the note with the recording running', async () => {
    renderApp()
    await openNoteAndRecord()
    await userEvent.click(screen.getByTestId('open-note-tab-close'))
    await screen.findByTestId('confirm-leave-button')

    await userEvent.click(screen.getByTestId('cancel-leave-button'))

    expect(screen.queryByTestId('confirm-leave-button')).toBeNull()
    expect(window.location.pathname).toBe(NOTE_PATH)
    expect(screen.getByTestId('note-title-input')).toBeInTheDocument()
    // The tab is still open too — declining must undo the whole action, not just the navigate.
    expect(screen.getByTestId('open-note-tab')).toBeInTheDocument()
  })

  it('confirming goes to the destination I actually clicked', async () => {
    renderApp()
    await openNoteAndRecord()
    await userEvent.click(screen.getByTestId('open-note-tab-close'))

    await userEvent.click(await screen.findByTestId('confirm-leave-button'))

    // It was the only note open, so closing it lands on the notes list.
    await waitFor(() => expect(window.location.pathname).toBe('/w/__default__'))
  })

  // The destination's side effects must wait for the leave too — declining has to leave
  // the app exactly as it was, not half-navigated. This drives the PREVIEW PANEL's own
  // open-note path (FolderPreviewPanel.onEditNote), which closes the panel as a side
  // effect: the panel must still be open, showing its folder, after declining.
  it('a note click in the folder preview opens it without asking', async () => {
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

    // 51-C: opening a note no longer unmounts the recording, so this no longer asks — it
    // just opens. There is no decline left to protect the panel from, which is why this
    // case now asserts the opposite of what it did under 49-A.
    await userEvent.click(within(panel).getByText('Retro'))

    expect(screen.queryByTestId('confirm-leave-button')).toBeNull()
    await waitFor(() => expect(window.location.pathname).toBe('/w/__default__/notes/note-2'))
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

  // 51-C removed the folder-click confirm, so "declining a folder click leaves the preview
  // panel closed" no longer describes anything — there is no decline on that path. The
  // source/destination split it protected still holds for the exits that DO confirm; the
  // workspace-switch case below is the surviving example (its popover must stay open).

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
  // plain action the rest of the time.
  it('closing a tab with no recording does not ask', async () => {
    renderApp()
    await userEvent.click(await screen.findByTestId('note-card-title'))
    await screen.findByTestId('note-title-input')

    await userEvent.click(screen.getByTestId('open-note-tab-close'))

    await waitFor(() => expect(window.location.pathname).toBe('/w/__default__'))
    expect(screen.queryByTestId('confirm-leave-button')).toBeNull()
  })

  // The real teardown risk: a guard registered for a FINISHED recording. The case above
  // never registers one at all, so it passes either way — this one only passes if the
  // guard is actually unregistered when recording stops.
  it('closing a tab after a recording has stopped does not ask', async () => {
    renderApp()
    await openNoteAndRecord()
    await userEvent.click(screen.getByTestId('mock-stop-recording'))

    await userEvent.click(screen.getByTestId('open-note-tab-close'))

    await waitFor(() => expect(window.location.pathname).toBe('/w/__default__'))
    expect(screen.queryByTestId('confirm-leave-button')).toBeNull()
  })

  // A recording that ends on its own while the confirm is up must not strand the user:
  // the banner goes, and the destination they asked for is honoured.
  it('stopping the recording while the confirm is showing completes the navigation', async () => {
    renderApp()
    await openNoteAndRecord()
    await userEvent.click(screen.getByTestId('open-note-tab-close'))
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
  /**
   * Both halves have to name the destination, so both are asserted every time: the visible
   * text, and the alertdialog's accessible NAME — the latter is what a screen reader
   * announces, and it is the half a refactor can silently drop without failing a
   * text-only assertion.
   */
  const banner = async (destination: string) => {
    expect((await screen.findByTestId('leave-confirm-text')).textContent).toBe(
      `Still recording — ${destination}?`,
    )
    expect(
      screen.getByRole('alertdialog', { name: `Recording in progress — ${destination}?` }),
    ).toBeInTheDocument()
  }

  const TWO_WORKSPACES = http.get('/api/workspaces', () =>
    HttpResponse.json({
      workspaces: [
        { workspaceId: '__default__', name: 'Personal', isDefault: true },
        { workspaceId: 'ws-2', name: 'Work', isDefault: false },
      ],
    }),
  )

  // 51-C dropped the Home / folder / Unfiled confirms, and with them their naming cases.
  // Closing the tab took over as the everyday guarded exit, so it takes over the coverage.
  it('names the tab close when I close the recording tab', async () => {
    renderApp()
    await openNoteAndRecord()

    await userEvent.click(screen.getByTestId('open-note-tab-close'))

    // Named for what the user asked for, not where it lands them (CHANGE-33): closing is the
    // action; ending up on the notes list is a consequence they did not choose.
    await banner('close this tab')
  })

  it('names the workspace when I switch workspace', async () => {
    server.use(TWO_WORKSPACES)
    renderApp()
    await openNoteAndRecord()

    await userEvent.click(screen.getByTestId('workspace-switcher-trigger'))
    await userEvent.click(await screen.findByTestId('workspace-option-ws-2'))

    await banner('switch to Work')
  })

  it('says sign out when I sign out', async () => {
    renderApp()
    await openNoteAndRecord()

    await userEvent.click(screen.getByTestId('sign-out-button'))

    await banner('sign out')
  })

  it('names the workspace when I move the note to another workspace', async () => {
    server.use(TWO_WORKSPACES)
    renderApp()
    await openNoteAndRecord()

    await userEvent.click(await screen.findByRole('button', { name: /^Move "Standup" to another workspace$/ }))
    await userEvent.click(await screen.findByTestId('move-workspace-option-ws-2'))

    await banner('move this note to Work')
  })

  // The note's own Save/back is not routed through the guard — it confirms locally, and
  // "Leave & save" exits to the deterministic workspace home (BUG-34), so it says so.
  it('names Home for the note’s own Save button', async () => {
    renderApp()
    await openNoteAndRecord()

    await userEvent.click(screen.getByTestId('save-button'))

    await banner('go to Home')
  })

  // The invisible half of CHANGE-33: a second guarded click replaces the pending
  // destination (last intent wins, which is right) — the banner has to show that it did.
  it('re-names itself when a second guarded click replaces the destination', async () => {
    server.use(TWO_WORKSPACES)
    renderApp()
    await openNoteAndRecord()
    await userEvent.click(screen.getByTestId('open-note-tab-close'))
    await banner('close this tab')

    await userEvent.click(screen.getByTestId('workspace-switcher-trigger'))
    await userEvent.click(await screen.findByTestId('workspace-option-ws-2'))

    await banner('switch to Work')
    await userEvent.click(screen.getByTestId('confirm-leave-button'))
    await waitFor(() => expect(window.location.pathname).toBe('/w/ws-2'))
  })

  // The replacement happens while the dialog is ALREADY open, and nothing focuses it — so
  // the announcement depends entirely on the live region, which no text assertion can see.
  it('marks the confirm as a live region so a replaced destination is re-announced', async () => {
    renderApp()
    await openNoteAndRecord()

    await userEvent.click(screen.getByTestId('open-note-tab-close'))

    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveAttribute('aria-live', 'assertive')
    // Atomic, or only the words that changed are read — "Clients?" on its own is not a
    // sentence, and the region is one short phrase either way.
    expect(dialog).toHaveAttribute('aria-atomic', 'true')
    // The live region belongs on the dialog itself: nested regions inside a role that
    // already carries implicit live semantics are announced twice or dropped.
    expect(within(dialog).getByTestId('leave-confirm-text')).not.toHaveAttribute('aria-live')
  })

  // Browser Back while a PARENT-requested confirm is showing supersedes it: that leave is
  // self-requested, so it must abandon the folder the user clicked and exit to the
  // deterministic home (BUG-34) — and the banner has to stop promising the folder.
  it('re-names to Home when browser Back supersedes a pending destination', async () => {
    renderApp()
    await openNoteAndRecord()
    await userEvent.click(screen.getByTestId('open-note-tab-close'))
    await banner('close this tab')

    window.history.back()

    await waitFor(async () => { await banner('go to Home') })
    await userEvent.click(screen.getByTestId('confirm-leave-button'))
    await waitFor(() => expect(window.location.pathname).toBe('/w/__default__'))
  })

  // openNote's own naming: the preview panel passes no title, so the name has to come from
  // the card list or the banner falls back to something anonymous.
  // "+ New Note" has no title to name — the note is created blank — so it says what it is.
  // 51-C removed the two openNote naming cases that used to live here ("open Retro" from the
  // folder preview, "open the new note" from + New Note). Neither path confirms any more, so
  // there is no banner to name. The destinations that DO still confirm — Home, a folder,
  // Unfiled, moving the note — keep their naming coverage above.
  //
  // Worth recording for [BUG-70]: its orphan note only appeared when the user DECLINED the
  // + New Note confirm. With no confirm on that path there is no decline, so the mechanism
  // that row describes does not survive this slice. Re-run its repro before fixing it.

  it('names the new workspace when creating one switches into it', async () => {
    renderApp()
    await openNoteAndRecord()
    await userEvent.click(screen.getByTestId('workspace-switcher-trigger'))
    await userEvent.click(await screen.findByTestId('workspace-create'))
    await userEvent.type(screen.getByLabelText('New workspace name'), 'Client work')
    await userEvent.keyboard('{Enter}')

    await banner('switch to Client work')
  })

  // A name is user-supplied and uncapped, and the confirm shares a header row with its two
  // buttons — so it is clipped rather than allowed to crowd them out.
  it('clips a very long workspace name', async () => {
    const longName = 'Client onboarding and account handover notes'
    server.use(
      http.get('/api/workspaces', () =>
        HttpResponse.json({
          workspaces: [
            { workspaceId: '__default__', name: 'Personal', isDefault: true },
            { workspaceId: 'ws-2', name: longName, isDefault: false },
          ],
        }),
      ),
    )
    renderApp()
    await openNoteAndRecord()

    await userEvent.click(screen.getByTestId('workspace-switcher-trigger'))
    await userEvent.click(await screen.findByTestId('workspace-option-ws-2'))

    await banner('switch to Client onboarding and account handover…')
  })
})
