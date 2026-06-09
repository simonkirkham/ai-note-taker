import userEvent from '@testing-library/user-event'
import { delay, http, HttpResponse } from 'msw'
import NoteView from '../components/NoteView'
import { ToastProvider } from '../components/ToastProvider'
import { render, screen, waitFor, fireEvent } from '../test/render'
import { server } from '../test/setup'

vi.mock('../components/NoteEditor', () => ({
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

vi.mock('../components/RecordControl', () => ({
  default: ({
    onTranscriptChange,
    onStatusChange,
  }: {
    onTranscriptChange: (t: string) => void
    onStatusChange?: (s: string) => void
  }) => (
    <div data-testid="record-control-mock">
      <button data-testid="transcription-record-button" onClick={() => onTranscriptChange('live words')}>
        Record
      </button>
      <button data-testid="mock-start-recording" onClick={() => onStatusChange?.('recording')}>
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

function renderNoteView(props: { noteId?: string; initialTitle?: string; onBack?: () => void; onDelete?: (noteId: string) => Promise<void>; onOpenNote?: (noteId: string, title?: string, isNew?: boolean) => void; isNew?: boolean } = {}) {
  const { noteId = 'note-1', initialTitle = 'Test Note', onBack = noop, onDelete = asyncNoop, onOpenNote = noop, isNew } = props
  return render(
    <ToastProvider>
      <NoteView
        noteId={noteId}
        initialTitle={initialTitle}
        onRename={noop}
        onBack={onBack}
        onDelete={onDelete}
        onDateSet={noop}
        onOpenNote={onOpenNote}
        isNew={isNew}
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
    expect(await screen.findByTestId('note-not-found')).toBeInTheDocument()
  })

  it('title input receives focus after note detail loads', async () => {
    renderNoteView()
    await screen.findByLabelText('Note content')
    expect(document.activeElement).toBe(screen.getByLabelText('Note title'))
  })

  it('Tab from title input reaches the tab list (via the Link to meeting control on an unlinked note)', async () => {
    renderNoteView()
    await screen.findByLabelText('Note content')
    screen.getByLabelText('Note title').focus()
    await userEvent.tab()
    expect(document.activeElement).toBe(screen.getByTestId('link-meeting-button'))
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

    it('keeps Tags and Action items visible on every tab', async () => {
      renderNoteView()
      await screen.findByLabelText('Note content')
      // Quick notes (default)
      expect(screen.getByTestId('tags-section')).toBeVisible()
      expect(screen.getByTestId('tag-input')).toBeVisible()
      // Transcript tab
      await userEvent.click(screen.getByTestId('note-tab-transcript'))
      expect(screen.getByTestId('tags-section')).toBeVisible()
      expect(screen.getByTestId('tag-input')).toBeVisible()
      // Final notes tab
      await userEvent.click(screen.getByTestId('note-tab-final'))
      expect(screen.getByTestId('tags-section')).toBeVisible()
      expect(screen.getByTestId('tag-input')).toBeVisible()
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
      const tagInput = screen.getByTestId('tag-input')
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
      const tagInput = screen.getByTestId('tag-input')
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
      const tagInput = await screen.findByTestId('tag-input')
      await userEvent.type(tagInput, 'planning')
      fireEvent.blur(tagInput)
      expect(await screen.findByTestId('tag-pill-planning')).toBeInTheDocument()
      await waitFor(() => expect(screen.queryByTestId('tag-pill-planning')).toBeNull())
      expect(await screen.findByRole('alert')).toHaveTextContent(/tag/i)
    })
  })
})
