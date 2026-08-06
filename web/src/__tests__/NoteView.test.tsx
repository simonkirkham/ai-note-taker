import userEvent from '@testing-library/user-event'
import { delay, http, HttpResponse } from 'msw'
import { useState } from 'react'
import NoteView from '../components/NoteView'
import { ToastProvider } from '../components/ToastProvider'
import { APP_TITLE } from '../hooks/useDocumentTitle'
import type { TranscriptionStatus, UseTranscriptionResult } from '../hooks/useTranscription'
import { render, screen, waitFor, fireEvent } from '../test/render'
import { server } from '../test/setup'

// NoteView renders the editor through LazyNoteEditor (19-I1: React.lazy + Suspense
// + lazy-chunk error boundary). Mock that wrapper with the synchronous textarea
// stand-in so these tests stay free of Suspense timing; the lazy behaviour itself
// is covered in LazyNoteEditor.test.tsx.
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

// 19-E2: the streaming hook now lives in NoteView (the parent) and is passed DOWN
// to RecordControl as the `transcription` prop. Mock the hook with a small stateful
// stand-in so tests can drive status/transcript, and let RecordControl be a passive
// renderer of those props (mirroring the real controlled component).
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
  default: ({
    transcription,
    hasInitialTranscript,
    initialTranscript,
  }: {
    transcription: UseTranscriptionResult
    hasInitialTranscript?: boolean
    initialTranscript?: string | null
  }) => (
    <div
      data-testid="record-control-mock"
      data-has-initial-transcript={hasInitialTranscript ? 'true' : 'false'}
      data-initial-transcript={initialTranscript ?? ''}
    >
      <button data-testid="transcription-record-button" onClick={() => transcription.startRecording(true, true)}>
        Record
      </button>
      <button data-testid="mock-start-recording" onClick={() => transcription.startRecording(true, true)}>
        Start recording
      </button>
    </div>
  ),
}))

const noop = () => {}
const asyncNoop = async () => {}

afterEach(() => {
  vi.useRealTimers()
})

function renderNoteView(props: { noteId?: string; initialTitle?: string; onBack?: () => void; onDelete?: (noteId: string) => Promise<void>; onOpenNote?: (noteId: string, title?: string, isNew?: boolean) => void; isNew?: boolean; otherWorkspaces?: { workspaceId: string; name: string }[]; onMoveToWorkspace?: (workspaceId: string) => void } = {}) {
  const { noteId = 'note-1', initialTitle = 'Test Note', onBack = noop, onDelete = asyncNoop, onOpenNote = noop, isNew, otherWorkspaces, onMoveToWorkspace } = props
  return render(
    <ToastProvider>
      <NoteView
        noteId={noteId}
        initialTitle={initialTitle}
        onBack={onBack}
        onDelete={onDelete}
        onDateSet={noop}
        onOpenNote={onOpenNote}
        isNew={isNew}
        otherWorkspaces={otherWorkspaces}
        onMoveToWorkspace={onMoveToWorkspace}
      />
    </ToastProvider>,
  )
}

function renderEmptyNoteView(onBack: () => void = noop) {
  server.use(
    http.get('/api/notes/:noteId', () =>
      HttpResponse.json({ noteId: 'note-1', title: '', content: '', date: null, tags: [] }),
    ),
  )
  return renderNoteView({ initialTitle: '', onBack })
}

describe('NoteView', () => {
  it('renders content returned by the API', async () => {
    let fetchCalled = false
    server.use(
      http.get('/api/notes/:noteId', () => {
        fetchCalled = true
        return HttpResponse.json({ noteId: 'note-1', title: 'T', content: 'Meeting notes', date: null, tags: [] })
      }),
    )
    renderNoteView()
    const textarea = await screen.findByLabelText('Note content')
    expect(textarea).toHaveValue('Meeting notes')
    await waitFor(() => expect(fetchCalled).toBe(true))
    expect(screen.queryByTestId('note-loading')).toBeNull()
  })

  it('sets the browser tab title from the open note', async () => {
    server.use(
      http.get('/api/notes/:noteId', () =>
        HttpResponse.json({ noteId: 'note-1', title: 'Roadmap review', content: 'x', date: null, tags: [] }),
      ),
    )
    renderNoteView()
    await waitFor(() => expect(document.title).toBe(`Roadmap review - ${APP_TITLE}`))
  })

  it('blurring the textarea triggers a PUT to save content', async () => {
    let savedContent: string | undefined
    server.use(
      http.put('/api/notes/:noteId/content', async ({ request }) => {
        const body = await request.json() as { content: string }
        savedContent = body.content
        return new HttpResponse(null, { status: 204 })
      }),
    )
    renderNoteView()
    const textarea = await screen.findByLabelText('Note content')
    await userEvent.clear(textarea)
    await userEvent.type(textarea, 'New content')
    await userEvent.tab()
    await waitFor(() => expect(savedContent).toBe('New content'))
  })

  // BUG-47: a save rejected as stale (409) must not silently drop the typed text — the conflict
  // banner surfaces it (copyable) and offers to load the note's newer content.
  it('shows the stale-conflict banner keeping the typed text when a save is rejected as stale', async () => {
    server.use(
      http.get('/api/notes/:noteId', () =>
        HttpResponse.json({ noteId: 'note-1', title: 'T', content: '', date: null, tags: [] })),
      http.put('/api/notes/:noteId/content', () =>
        HttpResponse.json({ error: 'stale_content' }, { status: 409 })),
    )
    renderNoteView()
    const textarea = await screen.findByLabelText('Note content')
    await userEvent.type(textarea, 'fragment I retyped')
    await userEvent.tab()

    await screen.findByTestId('stale-conflict-banner')
    expect(screen.getByTestId('stale-conflict-text')).toHaveValue('fragment I retyped')
  })

  it('load-latest reseeds the editor with the refetched server content after a stale conflict', async () => {
    let getCount = 0
    server.use(
      http.get('/api/notes/:noteId', () => {
        getCount += 1
        return HttpResponse.json({
          noteId: 'note-1', title: 'T', date: null, tags: [],
          content: getCount === 1 ? '' : 'The full server note',
        })
      }),
      http.put('/api/notes/:noteId/content', () =>
        HttpResponse.json({ error: 'stale_content' }, { status: 409 })),
    )
    renderNoteView()
    const textarea = await screen.findByLabelText('Note content')
    await userEvent.type(textarea, 'fragment')
    await userEvent.tab()
    await screen.findByTestId('stale-conflict-banner')

    await userEvent.click(screen.getByTestId('load-latest-content-button'))
    await waitFor(() =>
      expect(screen.getByLabelText('Note content')).toHaveValue('The full server note'))
  })

  it('dismiss hides the stale-conflict banner and keeps the typed text in the editor', async () => {
    server.use(
      http.get('/api/notes/:noteId', () =>
        HttpResponse.json({ noteId: 'note-1', title: 'T', content: '', date: null, tags: [] })),
      http.put('/api/notes/:noteId/content', () =>
        HttpResponse.json({ error: 'stale_content' }, { status: 409 })),
    )
    renderNoteView()
    const textarea = await screen.findByLabelText('Note content')
    await userEvent.type(textarea, 'my fragment')
    await userEvent.tab()
    await screen.findByTestId('stale-conflict-banner')

    await userEvent.click(screen.getByTestId('dismiss-stale-conflict-button'))
    await waitFor(() => expect(screen.queryByTestId('stale-conflict-banner')).toBeNull())
    expect(screen.getByLabelText('Note content')).toHaveValue('my fragment')
  })

  it('date defaults to today when API returns no date and auto-PATCHes the default date', async () => {
    let patchCalled = false
    server.use(
      http.patch('/api/notes/:noteId/date', () => {
        patchCalled = true
        return new HttpResponse(null, { status: 204 })
      }),
    )
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(new Date('2026-01-15'))
    renderNoteView()
    const dateInput = await screen.findByLabelText('Meeting date')
    await waitFor(() => expect((dateInput as HTMLInputElement).value).toBe('2026-01-15'))
    await waitFor(() => expect(patchCalled).toBe(true))
  })

  it('date input shows the value returned by the API', async () => {
    server.use(
      http.get('/api/notes/:noteId', () =>
        HttpResponse.json({ noteId: 'note-1', title: 'T', content: '', date: '2026-04-21', tags: [] }),
      ),
    )
    renderNoteView()
    const dateInput = await screen.findByLabelText('Meeting date')
    await waitFor(() => expect((dateInput as HTMLInputElement).value).toBe('2026-04-21'))
  })

  it('blurring the date input triggers a PATCH to save the date', async () => {
    let savedDate: string | undefined
    server.use(
      http.patch('/api/notes/:noteId/date', async ({ request }) => {
        const body = await request.json() as { date: string }
        savedDate = body.date
        return new HttpResponse(null, { status: 204 })
      }),
    )
    renderNoteView()
    const dateInput = await screen.findByLabelText('Meeting date')
    // Wait for API to settle before interacting — date inputs cannot use userEvent.type
    // because partial values (e.g. "2026-0") are sanitized to "" by the browser spec
    await waitFor(() => expect((dateInput as HTMLInputElement).value).not.toBe(''))
    fireEvent.change(dateInput, { target: { value: '2026-04-21' } })
    fireEvent.blur(dateInput)
    await waitFor(() => expect(savedDate).toBe('2026-04-21'))
  })

  it('renders the captured-notes label', async () => {
    renderNoteView()
    expect(await screen.findByTestId('captured-notes-label')).toBeInTheDocument()
  })

  it('shows note-not-found message when API returns 404', async () => {
    server.use(
      http.get('/api/notes/:noteId', () => new HttpResponse(null, { status: 404 })),
    )
    renderNoteView()
    const notFound = await screen.findByTestId('note-not-found')
    expect(notFound).toBeInTheDocument()
    expect(notFound).toHaveAttribute('role', 'alert') // 19-F1
  })

  it('title input receives focus after note detail loads', async () => {
    renderNoteView()
    await screen.findByLabelText('Note content')
    expect(document.activeElement).toBe(screen.getByLabelText('Note title'))
  })

  it('Tab from title input reaches the tab list (via the agenda, Link to meeting + the Command Bar)', async () => {
    renderNoteView()
    await screen.findByLabelText('Note content')
    screen.getByLabelText('Note title').focus()
    await userEvent.tab()
    // 43-A: the agenda lives in the header (with the title), so its add-item input is the first
    // stop after the title.
    expect(document.activeElement).toBe(screen.getByTestId('agenda-add-input'))
    await userEvent.tab()
    expect(document.activeElement).toBe(screen.getByTestId('link-meeting-button'))
    // CHANGE-27: the Command Bar (＋ Tag ghost, then the Actions pill) sits between the
    // link-meeting control and the tab row.
    await userEvent.tab()
    expect(document.activeElement).toBe(screen.getByTestId('add-tag-button'))
    await userEvent.tab()
    expect(document.activeElement).toBe(screen.getByTestId('actions-pill'))
    await userEvent.tab()
    expect(document.activeElement).toBe(screen.getByTestId('note-tab-quick'))
  })

  describe('three-tab layout', () => {
    it('opens on the Quick notes tab by default with three labelled tabs', async () => {
      renderNoteView()
      await screen.findByLabelText('Note content')
      expect(screen.getByTestId('note-tab-quick')).toHaveAttribute('aria-selected', 'true')
      expect(screen.getByTestId('note-tab-transcript')).toHaveAttribute('aria-selected', 'false')
      expect(screen.getByTestId('note-tab-final')).toHaveAttribute('aria-selected', 'false')
      expect(screen.getByRole('tab', { name: 'Quick notes' })).toBeInTheDocument()
      expect(screen.getByRole('tab', { name: 'Transcript' })).toBeInTheDocument()
      expect(screen.getByRole('tab', { name: 'Final notes' })).toBeInTheDocument()
    })

    it('switching to the Transcript tab shows the transcript read-only', async () => {
      server.use(
        http.get('/api/notes/:noteId', () =>
          HttpResponse.json({ noteId: 'note-1', title: 'T', content: '', date: null, tags: [], transcriptText: 'spoken words here' }),
        ),
      )
      renderNoteView()
      await screen.findByLabelText('Note content')
      await userEvent.click(screen.getByTestId('note-tab-transcript'))
      expect(screen.getByTestId('note-tab-transcript')).toHaveAttribute('aria-selected', 'true')
      expect(screen.getByTestId('transcription-text')).toHaveTextContent('spoken words here')
      // Read-only: there is no editable control inside the transcript panel.
      const panel = screen.getByTestId('note-tabpanel-transcript')
      expect(panel.querySelector('textarea')).toBeNull()
      expect(panel.querySelector('input')).toBeNull()
    })

    it('switching to the Final notes tab shows the final-notes view', async () => {
      server.use(
        http.get('/api/notes/:noteId', () =>
          HttpResponse.json({ noteId: 'note-1', title: 'T', content: '', date: null, tags: [], summary: 'A concise summary', summaryModelId: 'nova-lite' }),
        ),
      )
      renderNoteView()
      await screen.findByLabelText('Note content')
      await userEvent.click(screen.getByTestId('note-tab-final'))
      expect(screen.getByTestId('final-notes-summary')).toHaveTextContent('A concise summary')
    })

    it('shows the Final notes empty-state CTA when there is no summary', async () => {
      renderNoteView()
      await screen.findByLabelText('Note content')
      await userEvent.click(screen.getByTestId('note-tab-final'))
      expect(screen.getByTestId('generate-final-notes-button')).toBeInTheDocument()
    })

    it('keeps the Tags + Actions command bar visible on every tab', async () => {
      renderNoteView()
      await screen.findByLabelText('Note content')
      // The Command Bar sits above the tabs, so it stays visible regardless of tab.
      // Quick notes (default)
      expect(screen.getByTestId('command-bar')).toBeVisible()
      expect(screen.getByTestId('tags-section')).toBeVisible()
      expect(screen.getByTestId('add-tag-button')).toBeVisible()
      expect(screen.getByTestId('actions-pill')).toBeVisible()
      // Transcript tab
      await userEvent.click(screen.getByTestId('note-tab-transcript'))
      expect(screen.getByTestId('command-bar')).toBeVisible()
      expect(screen.getByTestId('actions-pill')).toBeVisible()
      // Final notes tab
      await userEvent.click(screen.getByTestId('note-tab-final'))
      expect(screen.getByTestId('command-bar')).toBeVisible()
      expect(screen.getByTestId('actions-pill')).toBeVisible()
    })

    it('renders the record control on the tab row', async () => {
      renderNoteView()
      await screen.findByLabelText('Note content')
      expect(screen.getByTestId('record-control-mock')).toBeInTheDocument()
    })

    it('Quick notes editor still saves via editContent on blur', async () => {
      let savedContent: string | undefined
      server.use(
        http.put('/api/notes/:noteId/content', async ({ request }) => {
          const body = await request.json() as { content: string }
          savedContent = body.content
          return new HttpResponse(null, { status: 204 })
        }),
      )
      renderNoteView()
      const textarea = await screen.findByLabelText('Note content')
      await userEvent.clear(textarea)
      await userEvent.type(textarea, 'My own notes')
      await userEvent.tab()
      await waitFor(() => expect(savedContent).toBe('My own notes'))
    })

    it('shows the /ai instruction discoverability hint (29-B)', async () => {
      renderNoteView()
      await screen.findByLabelText('Note content')
      const hint = screen.getByTestId('ai-instruction-hint')
      expect(hint).toBeVisible()
      expect(hint).toHaveTextContent('/ai')
      expect(hint).toHaveTextContent(/generate final notes/i)
    })
  })

  // BUG-18: content saves only on the editor's onBlur. Removing an inline image via
  // its ✕ control updates the doc (onChange fires) but never blurs the editor, so the
  // removal — and any un-blurred edit — was lost on navigate. Leaving the note must
  // flush a pending draft.
  describe('content flush on leave (BUG-18)', () => {
    it('saves a pending content edit when leaving via Save without the editor blurring', async () => {
      let saved: string | undefined
      server.use(
        http.put('/api/notes/:noteId/content', async ({ request }) => {
          saved = (await request.json() as { content: string }).content
          return new HttpResponse(null, { status: 204 })
        }),
      )
      const onBack = vi.fn()
      renderNoteView({ onBack })
      const textarea = await screen.findByLabelText('Note content')
      // Edit without blurring — mirrors removing an image: the doc changes (onChange),
      // but focus never leaves the editor so onBlur never fires.
      fireEvent.change(textarea, { target: { value: 'content with the image removed' } })
      await userEvent.click(screen.getByTestId('save-button'))
      await waitFor(() => expect(saved).toBe('content with the image removed'))
      expect(onBack).toHaveBeenCalledOnce()
    })

    it('flushes a pending content edit on unmount (navigating away)', async () => {
      let saved: string | undefined
      server.use(
        http.put('/api/notes/:noteId/content', async ({ request }) => {
          saved = (await request.json() as { content: string }).content
          return new HttpResponse(null, { status: 204 })
        }),
      )
      const { unmount } = renderNoteView()
      const textarea = await screen.findByLabelText('Note content')
      fireEvent.change(textarea, { target: { value: 'edited then navigated away' } })
      unmount()
      await waitFor(() => expect(saved).toBe('edited then navigated away'))
    })

    it('does not save on unmount when there is no pending edit', async () => {
      let putCalled = false
      server.use(
        http.put('/api/notes/:noteId/content', () => { putCalled = true; return new HttpResponse(null, { status: 204 }) }),
      )
      const { unmount } = renderNoteView()
      await screen.findByLabelText('Note content')
      unmount()
      await new Promise((r) => setTimeout(r, 20))
      expect(putCalled).toBe(false)
    })

    it('retries a failed content save when leaving (does not drop the kept text)', async () => {
      let puts = 0
      server.use(
        http.put('/api/notes/:noteId/content', () => { puts += 1; return new HttpResponse(null, { status: 500 }) }),
      )
      renderNoteView()
      const textarea = await screen.findByLabelText('Note content')
      fireEvent.change(textarea, { target: { value: 'keep me' } })
      fireEvent.blur(textarea)
      await waitFor(() => expect(puts).toBe(1))
      await screen.findByRole('alert')
      // Leaving must retry the still-pending draft, not silently drop it.
      await userEvent.click(screen.getByTestId('save-button'))
      await waitFor(() => expect(puts).toBe(2))
    })

    it('does not flush content when leaving via Delete', async () => {
      let putCalled = false
      server.use(
        http.put('/api/notes/:noteId/content', () => { putCalled = true; return new HttpResponse(null, { status: 204 }) }),
      )
      const onDelete = vi.fn().mockResolvedValue(undefined)
      const { unmount } = renderNoteView({ onDelete })
      const textarea = await screen.findByLabelText('Note content')
      fireEvent.change(textarea, { target: { value: 'unsaved edit on a note being deleted' } })
      await userEvent.click(screen.getByTestId('delete-note-button'))
      unmount()
      await new Promise((r) => setTimeout(r, 20))
      expect(onDelete).toHaveBeenCalledWith('note-1')
      expect(putCalled).toBe(false)
    })
  })

  describe('re-processing final notes', () => {
    it('leaves the Quick notes content byte-for-byte unchanged after re-processing', async () => {
      server.use(
        http.get('/api/notes/:noteId', () =>
          HttpResponse.json({
            noteId: 'note-1',
            title: 'T',
            content: '# Heading\n\nMy quick notes verbatim.',
            date: null,
            tags: [],
            summary: 'Original summary',
            summaryModelId: 'nova-lite',
          }),
        ),
        http.post('/api/notes/:noteId/analyse', () => new HttpResponse(null, { status: 204 })),
      )
      renderNoteView()
      const textarea = await screen.findByLabelText('Note content')
      const before = (textarea as HTMLTextAreaElement).value

      await userEvent.click(screen.getByTestId('note-tab-final'))
      await userEvent.click(screen.getByTestId('reprocess-final-notes-button'))
      await waitFor(() => expect(screen.getByTestId('reprocess-final-notes-button')).toBeEnabled())

      await userEvent.click(screen.getByTestId('note-tab-quick'))
      // tsc-test needs the cast (getByLabelText returns HTMLElement, no .value); eslint's
      // combined-project resolution disagrees and flags it as unnecessary.
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
      const after = (screen.getByLabelText('Note content') as HTMLTextAreaElement).value
      expect(after).toBe(before)
    })

    it('shows the regenerated summary after a successful re-process (latest wins)', async () => {
      let detailCalls = 0
      server.use(
        http.get('/api/notes/:noteId', () => {
          detailCalls += 1
          const summary = detailCalls === 1 ? 'Original summary' : 'Regenerated summary'
          return HttpResponse.json({
            noteId: 'note-1',
            title: 'T',
            content: 'Quick notes',
            date: null,
            tags: [],
            summary,
            summaryModelId: 'nova-lite',
          })
        }),
        http.post('/api/notes/:noteId/analyse', () => new HttpResponse(null, { status: 204 })),
      )
      renderNoteView()
      await screen.findByLabelText('Note content')

      await userEvent.click(screen.getByTestId('note-tab-final'))
      expect(screen.getByTestId('final-notes-summary')).toHaveTextContent('Original summary')

      await userEvent.click(screen.getByTestId('reprocess-final-notes-button'))
      await waitFor(() =>
        expect(screen.getByTestId('final-notes-summary')).toHaveTextContent('Regenerated summary'),
      )
    })

    // BUG-32: a just-typed /ai instruction was missed because Generate/Re-process fired
    // analysis without waiting for the fire-and-forget content save. Analysis must read the
    // saved content, so the /content PUT must complete before the /analyse POST.
    it('persists a just-typed content edit before analysing (BUG-32)', async () => {
      const calls: string[] = []
      server.use(
        http.get('/api/notes/:noteId', () =>
          HttpResponse.json({
            noteId: 'note-1', title: 'T', content: 'old notes', date: null, tags: [],
            summary: 'Original summary', summaryModelId: 'nova-lite',
          }),
        ),
        http.put('/api/notes/:noteId/content', async ({ request }) => {
          const body = await request.json() as { content: string }
          await delay(100)
          calls.push(`content:${body.content}`)
          return new HttpResponse(null, { status: 204 })
        }),
        http.post('/api/notes/:noteId/analyse', () => {
          calls.push('analyse')
          return new HttpResponse(null, { status: 204 })
        }),
      )
      renderNoteView()
      const textarea = await screen.findByLabelText('Note content')
      await userEvent.clear(textarea)
      await userEvent.type(textarea, '/ai add an agenda')

      await userEvent.click(screen.getByTestId('note-tab-final'))
      await userEvent.click(screen.getByTestId('reprocess-final-notes-button'))

      await waitFor(() => expect(calls).toContain('analyse'))
      // Content saved first (with the /ai line), THEN analysis ran.
      expect(calls).toEqual(['content:/ai add an agenda', 'analyse'])
    })
  })

  describe('next occurrence control', () => {
    function recurringNote() {
      server.use(
        http.get('/api/notes/:noteId', () =>
          HttpResponse.json({ noteId: 'note-1', title: 'Weekly Sync', content: 'c', date: null, tags: [], recurringSeriesId: 'series-9', isRecurring: true }),
        ),
      )
    }

    it('shows no Next occurrence button for a non-recurring note', async () => {
      renderNoteView()
      await screen.findByLabelText('Note content')
      expect(screen.queryByTestId('next-occurrence-button')).toBeNull()
    })

    it('shows a Next occurrence button for a recurring-meeting note', async () => {
      recurringNote()
      renderNoteView()
      await screen.findByLabelText('Note content')
      expect(await screen.findByTestId('next-occurrence-button')).toBeInTheDocument()
    })

    it('clicking Next occurrence creates-or-opens the next note and navigates to it', async () => {
      recurringNote()
      let seriesId: string | undefined
      server.use(
        http.post('/api/notes/from-next-occurrence', async ({ request }) => {
          const body = await request.json() as { recurringSeriesId: string }
          seriesId = body.recurringSeriesId
          return HttpResponse.json({ noteId: 'note-next', alreadyExists: true })
        }),
      )
      const onOpenNote = vi.fn()
      renderNoteView({ onOpenNote, initialTitle: 'Weekly Sync' })
      const button = await screen.findByTestId('next-occurrence-button')
      await userEvent.click(button)
      await waitFor(() => expect(onOpenNote).toHaveBeenCalled())
      expect(seriesId).toBe('series-9')
      expect(onOpenNote).toHaveBeenCalledWith('note-next', 'Weekly Sync', true)
    })

    it('shows an inline message and does not navigate when there is no upcoming occurrence', async () => {
      recurringNote()
      server.use(
        http.post('/api/notes/from-next-occurrence', () => new HttpResponse(null, { status: 404 })),
      )
      const onOpenNote = vi.fn()
      renderNoteView({ onOpenNote })
      const button = await screen.findByTestId('next-occurrence-button')
      await userEvent.click(button)
      expect(await screen.findByTestId('no-next-occurrence')).toBeInTheDocument()
      expect(onOpenNote).not.toHaveBeenCalled()
    })
  })

  describe('linked-meeting badge', () => {
    it('shows a linked-meeting badge when the note is linked to a meeting', async () => {
      server.use(
        http.get('/api/notes/:noteId', () =>
          HttpResponse.json({
            noteId: 'note-1', title: 'T', content: 'c', date: null, tags: [],
            linkedMeeting: {
              calendarEventId: 'evt_1', title: 'Design Review',
              startTime: '2026-05-14T09:00:00Z', endTime: '2026-05-14T09:30:00Z',
              recurringSeriesId: null, isRecurring: false,
            },
          }),
        ),
      )
      renderNoteView()
      const badge = await screen.findByTestId('linked-meeting-badge')
      expect(badge).toHaveTextContent(/Design Review/)
    })

    it('shows no linked-meeting badge for an unlinked note', async () => {
      server.use(
        http.get('/api/notes/:noteId', () =>
          HttpResponse.json({ noteId: 'note-1', title: 'T', content: 'c', date: null, tags: [], linkedMeeting: null }),
        ),
      )
      renderNoteView()
      await screen.findByLabelText('Note content')
      expect(screen.queryByTestId('linked-meeting-badge')).toBeNull()
    })

    it('removes the meeting link when Remove is clicked (optimistic, 44-B)', async () => {
      server.use(
        http.get('/api/notes/:noteId', () =>
          HttpResponse.json({
            noteId: 'note-1', title: 'T', content: 'c', date: null, tags: [],
            linkedMeeting: {
              calendarEventId: 'evt_1', title: 'Design Review',
              startTime: '2026-05-14T09:00:00Z', endTime: '2026-05-14T09:30:00Z',
              recurringSeriesId: null, isRecurring: false,
            },
          }),
        ),
        http.delete('/api/notes/:noteId/calendar-link', () => new HttpResponse(null, { status: 204 })),
      )
      renderNoteView()
      await screen.findByTestId('linked-meeting-badge')
      await userEvent.click(screen.getByTestId('unlink-meeting-button'))
      // Optimistic: the badge clears and the Link-to-meeting button returns.
      await waitFor(() => expect(screen.queryByTestId('linked-meeting-badge')).toBeNull())
      expect(await screen.findByTestId('link-meeting-button')).toBeInTheDocument()
    })
  })

  describe('link to meeting', () => {
    function unlinkedNote() {
      server.use(
        http.get('/api/notes/:noteId', () =>
          HttpResponse.json({ noteId: 'note-1', title: 'T', content: 'c', date: null, tags: [], linkedMeeting: null }),
        ),
      )
    }

    const meeting = {
      calendarEventId: 'evt_9', title: 'Design Review',
      startTime: '2026-05-14T09:00:00Z', endTime: '2026-05-14T09:30:00Z',
      isRecurring: false, recurringSeriesId: null,
      linkedNoteId: null, hasNextOccurrenceNote: false, nextOccurrenceNoteId: null,
    }

    it('shows a Link to meeting button when the note is unlinked', async () => {
      unlinkedNote()
      renderNoteView()
      expect(await screen.findByTestId('link-meeting-button')).toBeInTheDocument()
    })

    it('hides the Link to meeting button when the note is already linked', async () => {
      server.use(
        http.get('/api/notes/:noteId', () =>
          HttpResponse.json({
            noteId: 'note-1', title: 'T', content: 'c', date: null, tags: [],
            linkedMeeting: { calendarEventId: 'evt_1', title: 'Standup', startTime: '2026-05-14T09:00:00Z', endTime: '2026-05-14T09:15:00Z', recurringSeriesId: null, isRecurring: false },
          }),
        ),
      )
      renderNoteView()
      await screen.findByTestId('linked-meeting-badge')
      expect(screen.queryByTestId('link-meeting-button')).toBeNull()
    })

    it('opens the meeting picker listing the day\'s meetings', async () => {
      unlinkedNote()
      server.use(http.get('/api/calendar/:date', () => HttpResponse.json({ meetings: [meeting] })))
      renderNoteView()
      await userEvent.click(await screen.findByTestId('link-meeting-button'))
      expect(await screen.findByTestId('meeting-picker')).toBeInTheDocument()
      expect(await screen.findByTestId('picker-link-evt_9')).toBeInTheDocument()
    })

    it('selecting a meeting links it optimistically, shows the badge, hides the button, and POSTs', async () => {
      unlinkedNote()
      let linked = false
      server.use(
        http.get('/api/calendar/:date', () => HttpResponse.json({ meetings: [meeting] })),
        http.post('/api/notes/:noteId/calendar-link', async ({ request }) => {
          const body = await request.json() as { calendarEventId: string; calendarEventTitle: string }
          if (body.calendarEventId === 'evt_9' && body.calendarEventTitle === 'Design Review') linked = true
          return new HttpResponse(null, { status: 204 })
        }),
      )
      renderNoteView()
      await userEvent.click(await screen.findByTestId('link-meeting-button'))
      await userEvent.click(await screen.findByTestId('picker-link-evt_9'))
      const badge = await screen.findByTestId('linked-meeting-badge')
      expect(badge).toHaveTextContent(/Design Review/)
      expect(screen.queryByTestId('link-meeting-button')).toBeNull()
      await waitFor(() => expect(linked).toBe(true))
    })

    it('reverts the optimistic badge and reopens the picker when linking fails', async () => {
      unlinkedNote()
      server.use(
        http.get('/api/calendar/:date', () => HttpResponse.json({ meetings: [meeting] })),
        http.post('/api/notes/:noteId/calendar-link', () => new HttpResponse(null, { status: 409 })),
      )
      renderNoteView()
      await userEvent.click(await screen.findByTestId('link-meeting-button'))
      await userEvent.click(await screen.findByTestId('picker-link-evt_9'))
      await waitFor(() => expect(screen.queryByTestId('linked-meeting-badge')).toBeNull())
      expect(await screen.findByTestId('link-meeting-button')).toBeInTheDocument()
    })
  })

  describe('change meeting (Phase 44)', () => {
    function linkedToStandup() {
      server.use(
        http.get('/api/notes/:noteId', () =>
          HttpResponse.json({
            noteId: 'note-1', title: 'T', content: 'c', date: null, tags: [],
            linkedMeeting: { calendarEventId: 'evt_1', title: 'Standup', startTime: '2026-05-14T09:00:00Z', endTime: '2026-05-14T09:15:00Z', recurringSeriesId: null, isRecurring: false },
          }),
        ),
      )
    }

    const otherMeeting = {
      calendarEventId: 'evt_9', title: 'Budget review',
      startTime: '2026-05-14T10:00:00Z', endTime: '2026-05-14T10:30:00Z',
      isRecurring: false, recurringSeriesId: null,
      linkedNoteId: null, hasNextOccurrenceNote: false, nextOccurrenceNoteId: null,
    }

    it('shows a Change button on the linked-meeting badge', async () => {
      linkedToStandup()
      renderNoteView()
      await screen.findByTestId('linked-meeting-badge')
      expect(screen.getByTestId('change-meeting-button')).toBeInTheDocument()
    })

    it('Change opens the meeting picker', async () => {
      linkedToStandup()
      server.use(http.get('/api/calendar/:date', () => HttpResponse.json({ meetings: [otherMeeting] })))
      renderNoteView()
      await userEvent.click(await screen.findByTestId('change-meeting-button'))
      expect(await screen.findByTestId('meeting-picker')).toBeInTheDocument()
      expect(await screen.findByTestId('picker-link-evt_9')).toBeInTheDocument()
    })

    it('picking a different meeting swaps the badge optimistically and POSTs the new meeting', async () => {
      linkedToStandup()
      let posted: string | null = null
      server.use(
        http.get('/api/calendar/:date', () => HttpResponse.json({ meetings: [otherMeeting] })),
        http.post('/api/notes/:noteId/calendar-link', async ({ request }) => {
          const body = await request.json() as { calendarEventId: string }
          posted = body.calendarEventId
          return new HttpResponse(null, { status: 204 })
        }),
      )
      renderNoteView()
      await userEvent.click(await screen.findByTestId('change-meeting-button'))
      await userEvent.click(await screen.findByTestId('picker-link-evt_9'))
      const badge = await screen.findByTestId('linked-meeting-badge')
      expect(badge).toHaveTextContent(/Budget review/)
      await waitFor(() => expect(posted).toBe('evt_9'))
    })
  })

  describe('adaptive action buttons', () => {
    it('blank note shows only Cancel — Save and Delete are not in the DOM', async () => {
      renderEmptyNoteView()
      await screen.findByLabelText('Note content')
      expect(screen.getByTestId('cancel-button')).toBeInTheDocument()
      expect(screen.queryByTestId('save-button')).toBeNull()
      expect(screen.queryByTestId('delete-note-button')).toBeNull()
    })

    it('note with a title shows Save and Delete — Cancel is not in the DOM', async () => {
      renderNoteView()
      await screen.findByLabelText('Note content')
      expect(screen.getByTestId('save-button')).toBeInTheDocument()
      expect(screen.getByTestId('delete-note-button')).toBeInTheDocument()
      expect(screen.queryByTestId('cancel-button')).toBeNull()
    })

    it('typing a title on a blank note reveals Save and Delete and hides Cancel', async () => {
      renderEmptyNoteView()
      await screen.findByLabelText('Note content')
      expect(screen.getByTestId('cancel-button')).toBeInTheDocument()
      await userEvent.type(screen.getByLabelText('Note title'), 'My note')
      expect(screen.getByTestId('save-button')).toBeInTheDocument()
      expect(screen.getByTestId('delete-note-button')).toBeInTheDocument()
      expect(screen.queryByTestId('cancel-button')).toBeNull()
    })

    it('typing content on a blank note reveals Save and Delete', async () => {
      renderEmptyNoteView()
      const textarea = await screen.findByLabelText('Note content')
      await userEvent.type(textarea, 'Some content')
      expect(screen.getByTestId('save-button')).toBeInTheDocument()
      expect(screen.getByTestId('delete-note-button')).toBeInTheDocument()
    })

    it('adding a tag on a blank note reveals Save and Delete', async () => {
      renderEmptyNoteView()
      await screen.findByLabelText('Note content')
      await userEvent.click(screen.getByTestId('add-tag-button'))
      const tagInput = await screen.findByTestId('tag-input')
      await userEvent.type(tagInput, 'planning')
      fireEvent.blur(tagInput)
      await waitFor(() => expect(screen.queryByTestId('save-button')).toBeInTheDocument())
      expect(screen.getByTestId('delete-note-button')).toBeInTheDocument()
    })

    it('action items loading reveals Save and Delete', async () => {
      server.use(
        http.get('/api/notes/:noteId/actions', () =>
          HttpResponse.json({ actions: [{ actionId: 'a-1', description: 'Follow up', completed: false, addedAt: new Date().toISOString(), completedAt: null }] }),
        ),
      )
      renderEmptyNoteView()
      await waitFor(() => expect(screen.queryByTestId('save-button')).toBeInTheDocument())
      expect(screen.getByTestId('delete-note-button')).toBeInTheDocument()
    })

    it('Save button calls onBack', async () => {
      const onBack = vi.fn()
      renderNoteView({ onBack })
      await screen.findByLabelText('Note content')
      await userEvent.click(screen.getByTestId('save-button'))
      expect(onBack).toHaveBeenCalledOnce()
    })

    it('Delete button calls onDelete with the noteId', async () => {
      const onDelete = vi.fn().mockResolvedValue(undefined)
      renderNoteView({ onDelete })
      await screen.findByLabelText('Note content')
      await userEvent.click(screen.getByTestId('delete-note-button'))
      expect(onDelete).toHaveBeenCalledWith('note-1')
    })

    it('Cancel on a blank existing note calls onBack without deleting', async () => {
      const onBack = vi.fn()
      renderEmptyNoteView(onBack)
      await screen.findByLabelText('Note content')
      await userEvent.click(screen.getByTestId('cancel-button'))
      expect(onBack).toHaveBeenCalledOnce()
      expect(screen.queryByTestId('cancel-dialog')).toBeNull()
    })

    it('Cancel on a blank new note calls onDelete without a dialog', async () => {
      const onDelete = vi.fn().mockResolvedValue(undefined)
      server.use(
        http.get('/api/notes/:noteId', () =>
          HttpResponse.json({ noteId: 'note-1', title: '', content: '', date: null, tags: [] }),
        ),
      )
      renderNoteView({ initialTitle: '', onDelete, isNew: true })
      await screen.findByLabelText('Note content')
      await userEvent.click(screen.getByTestId('cancel-button'))
      expect(onDelete).toHaveBeenCalledWith('note-1')
      expect(screen.queryByTestId('cancel-dialog')).toBeNull()
    })

    it('leaving while recording warns first and only calls onBack on confirm', async () => {
      const onBack = vi.fn()
      renderNoteView({ onBack })
      await screen.findByLabelText('Note content')

      await userEvent.click(screen.getByTestId('mock-start-recording'))

      // Save now warns instead of leaving immediately.
      await userEvent.click(screen.getByTestId('save-button'))
      expect(onBack).not.toHaveBeenCalled()
      expect(screen.getByTestId('confirm-leave-button')).toBeInTheDocument()

      // "Keep recording" dismisses the warning without leaving.
      await userEvent.click(screen.getByTestId('cancel-leave-button'))
      expect(screen.queryByTestId('confirm-leave-button')).toBeNull()
      expect(onBack).not.toHaveBeenCalled()

      // Confirming leaves.
      await userEvent.click(screen.getByTestId('save-button'))
      await userEvent.click(screen.getByTestId('confirm-leave-button'))
      expect(onBack).toHaveBeenCalledOnce()
    })

    // BUG-34: Alt+← (browser back) fires popstate, which the beforeunload warning
    // cannot catch and which the in-app Save button's confirm never sees — so it
    // silently unmounted the note mid-recording and the transcript was lost. While
    // recording, popstate must surface the same leave-confirm instead of navigating.
    it('browser back (popstate) while recording warns instead of leaving silently', async () => {
      const onBack = vi.fn()
      renderNoteView({ onBack })
      await screen.findByLabelText('Note content')
      await userEvent.click(screen.getByTestId('mock-start-recording'))

      // Simulate the browser Back button — NOT the in-app Save button.
      fireEvent.popState(window)

      expect(screen.getByTestId('confirm-leave-button')).toBeInTheDocument()
      expect(onBack).not.toHaveBeenCalled()
    })

    it('browser back (popstate) when NOT recording does not show the leave warning', async () => {
      renderNoteView()
      await screen.findByLabelText('Note content')

      fireEvent.popState(window)

      expect(screen.queryByTestId('confirm-leave-button')).toBeNull()
    })

    it('note with only a transcript (blank title/content/tags) shows Save and Delete', async () => {
      server.use(
        http.get('/api/notes/:noteId', () =>
          HttpResponse.json({ noteId: 'note-1', title: '', content: '', date: null, tags: [], transcriptText: 'words words words' }),
        ),
      )
      renderNoteView({ initialTitle: '' })
      await screen.findByLabelText('Note content')
      await waitFor(() => expect(screen.queryByTestId('save-button')).toBeInTheDocument())
      expect(screen.getByTestId('delete-note-button')).toBeInTheDocument()
      expect(screen.queryByTestId('cancel-button')).toBeNull()
    })
  })

  describe('transcript recovery banner', () => {
    function withDraft() {
      server.use(
        http.get('/api/notes/:noteId', () =>
          HttpResponse.json({
            noteId: 'note-1', title: 'T', content: '', date: null, tags: [],
            transcriptDraft: { text: 'Speaker 1: recovered words', capturedAt: '2026-06-05T10:00:00Z' },
          }),
        ),
      )
    }

    it('shows the recovery banner when the note has an uncommitted transcript draft', async () => {
      withDraft()
      renderNoteView()
      expect(await screen.findByTestId('transcript-recovery-banner')).toBeInTheDocument()
      expect(screen.getByTestId('recover-transcript-button')).toBeInTheDocument()
      expect(screen.getByTestId('discard-transcript-button')).toBeInTheDocument()
    })

    it('opening a note with a draft never auto-commits', async () => {
      withDraft()
      let committed = false
      server.use(
        http.post('/api/notes/note-1/transcription', () => { committed = true; return new HttpResponse(null, { status: 204 }) }),
      )
      renderNoteView()
      await screen.findByTestId('transcript-recovery-banner')
      expect(committed).toBe(false)
    })

    it('Recover commits the draft (POST) and hides the banner', async () => {
      withDraft()
      let committedBody: unknown = null
      server.use(
        http.post('/api/notes/note-1/transcription', async ({ request }) => {
          committedBody = await request.json()
          return new HttpResponse(null, { status: 204 })
        }),
      )
      renderNoteView()
      await userEvent.click(await screen.findByTestId('recover-transcript-button'))
      await waitFor(() => expect(committedBody).toMatchObject({ transcriptText: 'Speaker 1: recovered words' }))
      expect(screen.queryByTestId('transcript-recovery-banner')).toBeNull()
    })

    it('Discard deletes the draft (DELETE) and hides the banner', async () => {
      withDraft()
      let discarded = false
      server.use(
        http.delete('/api/notes/note-1/transcription/draft', () => { discarded = true; return new HttpResponse(null, { status: 204 }) }),
      )
      renderNoteView()
      await userEvent.click(await screen.findByTestId('discard-transcript-button'))
      await waitFor(() => expect(discarded).toBe(true))
      expect(screen.queryByTestId('transcript-recovery-banner')).toBeNull()
    })

    // BUG-34: an interrupted recording leaves a draft but no committed transcript.
    // "Continue (append)" keyed only off the committed transcript, so re-recording
    // started fresh and the new commit overwrote+deleted the draft — the prior half
    // was lost. The draft must be continuable: Record offers Continue, seeded from it.
    it('makes Record continue from an interrupted draft (no committed transcript)', async () => {
      withDraft()
      renderNoteView()
      const control = await screen.findByTestId('record-control-mock')
      await waitFor(() => expect(control).toHaveAttribute('data-has-initial-transcript', 'true'))
      expect(control).toHaveAttribute('data-initial-transcript', 'Speaker 1: recovered words')
    })

    it('a note with neither a transcript nor a draft starts recording fresh (no continue)', async () => {
      server.use(
        http.get('/api/notes/:noteId', () =>
          HttpResponse.json({ noteId: 'note-1', title: 'T', content: '', date: null, tags: [] }),
        ),
      )
      renderNoteView()
      const control = await screen.findByTestId('record-control-mock')
      expect(control).toHaveAttribute('data-has-initial-transcript', 'false')
    })
  })

  // 20-E: note-detail is one keys.note(id) cache. The draft pattern protects
  // in-flight edits from refetches; commits are optimistic and surface failures.
  describe('TanStack note-detail (20-E)', () => {
    it('does not clobber in-progress typing when the note refetches', async () => {
      server.use(
        http.get('/api/notes/:noteId', () =>
          HttpResponse.json({ noteId: 'note-1', title: 'T', content: 'server copy', date: '2026-04-21', tags: [] })),
        http.post('/api/notes/:noteId/tags', () => new HttpResponse(null, { status: 204 })),
      )
      renderNoteView()
      const textarea = await screen.findByLabelText('Note content')
      await userEvent.clear(textarea)
      await userEvent.type(textarea, 'my unsaved words')
      // Trigger a keys.note refetch path (adding a tag invalidates the index and the
      // note cache via optimistic patch); the unsaved draft must survive.
      await userEvent.click(screen.getByTestId('add-tag-button'))
      const tagInput = await screen.findByTestId('tag-input')
      await userEvent.type(tagInput, 'planning')
      fireEvent.blur(tagInput)
      await waitFor(() => expect(screen.queryByTestId('tag-pill-planning')).toBeInTheDocument())
      expect(textarea).toHaveValue('my unsaved words')
    })

    it('surfaces an error but keeps the typed text when saving content fails', async () => {
      server.use(
        http.get('/api/notes/:noteId', () =>
          HttpResponse.json({ noteId: 'note-1', title: 'T', content: '', date: '2026-04-21', tags: [] })),
        http.put('/api/notes/:noteId/content', () => new HttpResponse(null, { status: 500 })),
      )
      renderNoteView()
      const textarea = await screen.findByLabelText('Note content')
      await userEvent.type(textarea, 'My unsaved words')
      await userEvent.tab()
      expect(await screen.findByRole('alert')).toBeInTheDocument()
      expect(textarea).toHaveValue('My unsaved words')
    })

    it('adding a tag is optimistic and reverts on failure', async () => {
      server.use(
        http.get('/api/notes/:noteId', () =>
          HttpResponse.json({ noteId: 'note-1', title: 'T', content: 'c', date: '2026-04-21', tags: [] })),
        http.post('/api/notes/:noteId/tags', async () => { await delay(60); return new HttpResponse(null, { status: 500 }) }),
      )
      renderNoteView()
      await screen.findByLabelText('Note content')
      await userEvent.click(screen.getByTestId('add-tag-button'))
      const tagInput = await screen.findByTestId('tag-input')
      await userEvent.type(tagInput, 'planning')
      fireEvent.blur(tagInput)
      expect(await screen.findByTestId('tag-pill-planning')).toBeInTheDocument()
      await waitFor(() => expect(screen.queryByTestId('tag-pill-planning')).toBeNull())
      expect(await screen.findByRole('alert')).toHaveTextContent(/tag/i)
    })
  })

  // 19-E2: the streaming transcription hook was lifted into NoteView (the common
  // parent) and RecordControl made controlled — state flows DOWN as the
  // `transcription` prop instead of the child pushing it UP via effect-fired
  // callbacks. RecordControl no longer has the upward status/transcript callback props.
  describe('lifted transcription state (19-E2)', () => {
    it('recording status drives the in-recording UI via the lifted hook (no upward status callback)', async () => {
      const onBack = vi.fn()
      renderNoteView({ onBack })
      await screen.findByLabelText('Note content')

      // Drive the hook to "recording" through the prop the parent passes down.
      await userEvent.click(screen.getByTestId('mock-start-recording'))

      // isRecording is now derived from the lifted hook's status: leaving warns first.
      await userEvent.click(screen.getByTestId('save-button'))
      expect(onBack).not.toHaveBeenCalled()
      expect(screen.getByTestId('confirm-leave-button')).toBeInTheDocument()
    })

    it('surfaces the live transcript while recording but not once idle (status-gate preserved)', async () => {
      server.use(
        http.get('/api/notes/:noteId', () =>
          HttpResponse.json({ noteId: 'note-1', title: 'T', content: '', date: null, tags: [], transcriptText: null })),
      )
      renderNoteView()
      await screen.findByLabelText('Note content')

      // Idle: no live transcript surfaced on the Transcript tab.
      await userEvent.click(screen.getByTestId('note-tab-transcript'))
      expect(screen.queryByTestId('transcription-text')).toBeNull()

      // Recording: the live transcript ("live words") is surfaced.
      await userEvent.click(screen.getByTestId('transcription-record-button'))
      await waitFor(() =>
        expect(screen.getByTestId('transcription-text')).toHaveTextContent('live words'))
    })

    it('unmounting mid-recording produces no warning and no post-unmount callback', async () => {
      const { unmount } = renderNoteView()
      await screen.findByLabelText('Note content')
      await userEvent.click(screen.getByTestId('mock-start-recording'))
      // No callback exists for the child to fire after unmount; unmount is clean.
      expect(() => unmount()).not.toThrow()
    })
  })

  // BUG-21: the title was seeded once from initialTitle and never reconciled with
  // the authoritative detail.title; a navigation path passing no title showed an
  // empty field, and the auto-focused input's blur then persisted that empty value,
  // permanently overwriting the real title. The title now uses the draft pattern
  // (titleDraft ?? detail.title ?? initialTitle) and an empty/unchanged blur never PATCHes.
  describe('title reconciliation (BUG-21)', () => {
    it('renders the authoritative detail.title even when initialTitle is empty', async () => {
      server.use(
        http.get('/api/notes/:noteId', () =>
          HttpResponse.json({ noteId: 'note-1', title: 'Interview: Simon Kirkham', content: 'c', date: null, tags: [] })),
      )
      renderNoteView({ initialTitle: '' })
      await screen.findByLabelText('Note content')
      await waitFor(() =>
        expect(screen.getByLabelText('Note title')).toHaveValue('Interview: Simon Kirkham'))
    })

    it('blurring the auto-focused title input does not PATCH an empty title', async () => {
      let patched: string | undefined
      let patchCalled = false
      server.use(
        http.get('/api/notes/:noteId', () =>
          HttpResponse.json({ noteId: 'note-1', title: 'Interview: Simon Kirkham', content: 'c', date: null, tags: [] })),
        http.patch('/api/notes/:noteId/title', async ({ request }) => {
          patchCalled = true
          patched = (await request.json() as { title: string }).title
          return new HttpResponse(null, { status: 204 })
        }),
      )
      renderNoteView({ initialTitle: '' })
      await screen.findByLabelText('Note content')
      // Title reconciled to the real value; blurring without editing must not persist.
      await waitFor(() => expect(screen.getByLabelText('Note title')).toHaveValue('Interview: Simon Kirkham'))
      fireEvent.blur(screen.getByLabelText('Note title'))
      await new Promise((r) => setTimeout(r, 20))
      expect(patchCalled).toBe(false)
      expect(patched).toBeUndefined()
    })

    it('does not PATCH when the title is cleared to empty', async () => {
      let patchCalled = false
      server.use(
        http.get('/api/notes/:noteId', () =>
          HttpResponse.json({ noteId: 'note-1', title: 'Interview: Simon Kirkham', content: 'c', date: null, tags: [] })),
        http.patch('/api/notes/:noteId/title', () => { patchCalled = true; return new HttpResponse(null, { status: 204 }) }),
      )
      renderNoteView({ initialTitle: 'Interview: Simon Kirkham' })
      const titleInput = await screen.findByLabelText('Note title')
      await userEvent.clear(titleInput)
      fireEvent.blur(titleInput)
      await new Promise((r) => setTimeout(r, 20))
      expect(patchCalled).toBe(false)
    })

    it('renaming to a new title PATCHes the new value and reconciles', async () => {
      let patched: string | undefined
      server.use(
        http.get('/api/notes/:noteId', () =>
          HttpResponse.json({ noteId: 'note-1', title: 'Old title', content: 'c', date: null, tags: [] })),
        http.patch('/api/notes/:noteId/title', async ({ request }) => {
          patched = (await request.json() as { title: string }).title
          return new HttpResponse(null, { status: 204 })
        }),
      )
      renderNoteView({ initialTitle: 'Old title' })
      const titleInput = await screen.findByLabelText('Note title')
      await userEvent.clear(titleInput)
      await userEvent.type(titleInput, 'New title')
      fireEvent.blur(titleInput)
      await waitFor(() => expect(patched).toBe('New title'))
      expect(titleInput).toHaveValue('New title')
    })

    it('surfaces an error but keeps the typed title when the rename fails', async () => {
      server.use(
        http.get('/api/notes/:noteId', () =>
          HttpResponse.json({ noteId: 'note-1', title: 'Old title', content: 'c', date: null, tags: [] })),
        http.patch('/api/notes/:noteId/title', () => new HttpResponse(null, { status: 500 })),
      )
      renderNoteView({ initialTitle: 'Old title' })
      const titleInput = await screen.findByLabelText('Note title')
      await userEvent.clear(titleInput)
      await userEvent.type(titleInput, 'New title')
      fireEvent.blur(titleInput)
      expect(await screen.findByRole('alert')).toBeInTheDocument()
      // The typed title must not be reset to the stale server copy on failure.
      expect(titleInput).toHaveValue('New title')
    })
  })

  describe('move to another workspace (CHANGE-24)', () => {
    it('shows a Move control and fires onMoveToWorkspace with the chosen workspace', async () => {
      const onMoveToWorkspace = vi.fn()
      renderNoteView({
        otherWorkspaces: [
          { workspaceId: 'ws-clients', name: 'Clients' },
          { workspaceId: 'ws-personal', name: 'Personal' },
        ],
        onMoveToWorkspace,
      })
      await userEvent.click(await screen.findByRole('button', { name: 'Move "Test Note" to another workspace' }))
      await userEvent.click(screen.getByTestId('move-workspace-option-ws-clients'))
      expect(onMoveToWorkspace).toHaveBeenCalledWith('ws-clients')
    })

    it('shows no Move control when there are no other workspaces', async () => {
      renderNoteView({ otherWorkspaces: [], onMoveToWorkspace: noop })
      await screen.findByLabelText('Note content')
      expect(screen.queryByRole('button', { name: /Move "Test Note"/ })).not.toBeInTheDocument()
    })
  })
})
