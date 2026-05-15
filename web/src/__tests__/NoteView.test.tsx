import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '../test/setup'
import NoteView from '../components/NoteView'

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

const noop = () => {}
const asyncNoop = async () => {}

afterEach(() => {
  vi.useRealTimers()
})

function renderNoteView(noteId = 'note-1') {
  return render(
    <NoteView
      noteId={noteId}
      initialTitle="Test Note"
      onRename={noop}
      onBack={noop}
      onDelete={asyncNoop}
      onDateSet={noop}
    />,
  )
}

describe('NoteView', () => {
  it('renders content returned by the API', async () => {
    let fetchCalled = false
    server.use(
      http.get('/notes/:noteId', () => {
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
      http.put('/notes/:noteId/content', async ({ request }) => {
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
      http.patch('/notes/:noteId/date', () => {
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
      http.get('/notes/:noteId', () =>
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
      http.patch('/notes/:noteId/date', async ({ request }) => {
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
      http.get('/notes/:noteId', () => new HttpResponse(null, { status: 404 })),
    )
    renderNoteView()
    expect(await screen.findByTestId('note-not-found')).toBeInTheDocument()
  })
})
