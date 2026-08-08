import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render as rtlRender, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import type { ReactNode } from 'react'
import type { NoteDetail } from '../api/notes'
import { keys } from '../api/queryKeys'
import AgendaSection from '../components/AgendaSection'
import { server } from '../test/setup'

const NOTE_ID = 'note-1'

function noteWith(agenda: NoteDetail['agenda']): NoteDetail {
  return {
    noteId: NOTE_ID, title: 'T', content: '', date: null, tags: [],
    transcriptText: null, transcriptDraft: null, recordingAudioKey: null,
    transcriptIsDiarized: false, summary: null, discussionPoints: [], decisions: [],
    instructionResponses: [], summaryModelId: null, summaryPromptVersion: null,
    agenda, recurringSeriesId: null, isRecurring: false, linkedMeeting: null,
  }
}

// Renders with a QueryClient whose keys.note(NOTE_ID) cache is pre-seeded, so AgendaSection reads
// the agenda from the shared note-detail cache exactly as it does mounted under NoteView.
function renderAgenda(agenda: NoteDetail['agenda'] = []) {
  // staleTime: Infinity so useNoteDetail trusts the seeded cache and does not refetch on mount
  // (an on-mount refetch hitting the default no-agenda GET handler would race and wipe the seed).
  // A mutation's onSettled invalidateQueries still forces a refetch regardless, so reconciliation
  // paths are exercised; this only removes the spurious mount refetch.
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } })
  qc.setQueryData(keys.note(NOTE_ID), noteWith(agenda))
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  )
  return { qc, ...rtlRender(<AgendaSection noteId={NOTE_ID} />, { wrapper: Wrapper }) }
}

describe('AgendaSection', () => {
  it('renders existing agenda items in capture order', () => {
    renderAgenda([
      { itemId: 'i-1', text: 'Budget (Q3)', discussed: false, position: 0 },
      { itemId: 'i-2', text: 'Hiring backfill', discussed: false, position: 1 },
    ])
    const texts = screen.getAllByTestId('agenda-item-text')
    expect(texts.map((t) => t.textContent)).toEqual(['Budget (Q3)', 'Hiring backfill'])
  })

  it('shows an empty, add-ready agenda for a note with no items', () => {
    renderAgenda([])
    expect(screen.queryByTestId('agenda-item')).toBeNull()
    expect(screen.getByTestId('agenda-add-input')).toBeInTheDocument()
  })

  it('adds an item optimistically on Enter, before the server responds', async () => {
    // Block the POST resolving until released, proving the item appears optimistically (not after
    // the server reply). The onSettled refetch then reconciles to the server item id.
    let release: () => void = () => {}
    const gate = new Promise<void>((r) => { release = r })
    let posted = false
    server.use(
      http.post(`/api/notes/${NOTE_ID}/agenda-items`, async () => {
        posted = true
        await gate
        return HttpResponse.json({ itemId: 'real-1' }, { status: 201 })
      }),
      http.get(`/api/notes/${NOTE_ID}`, () =>
        HttpResponse.json(noteWith(posted
          ? [{ itemId: 'real-1', text: 'Budget (Q3)', discussed: false, position: 0 }]
          : []))),
    )
    renderAgenda([])

    const input = screen.getByTestId('agenda-add-input')
    await userEvent.type(input, 'Budget (Q3){Enter}')

    // Optimistic: the item is visible and the input cleared while the POST is still pending.
    expect(await screen.findByText('Budget (Q3)')).toBeInTheDocument()
    expect((input as HTMLInputElement).value).toBe('')
    await waitFor(() => expect(posted).toBe(true))

    release()
    // After settle, the item remains (reconciled to the server copy).
    await waitFor(() => expect(screen.getByText('Budget (Q3)')).toBeInTheDocument())
  })

  it('rolls the optimistic item back when the add fails', async () => {
    server.use(
      http.post(`/api/notes/${NOTE_ID}/agenda-items`, () => new HttpResponse(null, { status: 500 })),
      http.get(`/api/notes/${NOTE_ID}`, () => HttpResponse.json(noteWith([]))),
    )
    renderAgenda([])

    const input = screen.getByTestId('agenda-add-input')
    await userEvent.type(input, 'Budget (Q3){Enter}')

    await waitFor(() => expect(screen.queryByText('Budget (Q3)')).not.toBeInTheDocument())
  })

  it('ignores a blank item (no request, input retains nothing)', async () => {
    let posted = false
    server.use(
      http.post(`/api/notes/${NOTE_ID}/agenda-items`, () => {
        posted = true
        return HttpResponse.json({ itemId: 'x' }, { status: 201 })
      }),
    )
    renderAgenda([])

    const input = screen.getByTestId('agenda-add-input')
    await userEvent.type(input, '   {Enter}')

    expect(posted).toBe(false)
    expect(screen.queryByTestId('agenda-item')).toBeNull()
  })

  it('shows the coverage count and updates it as items are ticked optimistically', async () => {
    server.use(
      http.put(`/api/notes/${NOTE_ID}/agenda-items/:itemId/discussed`, () => new HttpResponse(null, { status: 204 })),
      http.get(`/api/notes/${NOTE_ID}`, () =>
        HttpResponse.json(noteWith([
          { itemId: 'i-1', text: 'Budget (Q3)', discussed: true, position: 0 },
          { itemId: 'i-2', text: 'Hiring backfill', discussed: false, position: 1 },
        ]))),
    )
    renderAgenda([
      { itemId: 'i-1', text: 'Budget (Q3)', discussed: false, position: 0 },
      { itemId: 'i-2', text: 'Hiring backfill', discussed: false, position: 1 },
    ])
    expect(screen.getByTestId('agenda-coverage')).toHaveTextContent('0 / 2')

    const firstCheck = screen.getAllByTestId('agenda-item-check')[0]
    await userEvent.click(firstCheck)

    // Optimistic: coverage and the checkbox reflect the tick immediately.
    await waitFor(() => expect(screen.getByTestId('agenda-coverage')).toHaveTextContent('1 / 2'))
    expect(screen.getAllByTestId('agenda-item-check')[0]).toBeChecked()
  })

  it('rolls a tick back when the server rejects it', async () => {
    server.use(
      http.put(`/api/notes/${NOTE_ID}/agenda-items/:itemId/discussed`, () => new HttpResponse(null, { status: 500 })),
      http.get(`/api/notes/${NOTE_ID}`, () =>
        HttpResponse.json(noteWith([{ itemId: 'i-1', text: 'Budget (Q3)', discussed: false, position: 0 }]))),
    )
    renderAgenda([{ itemId: 'i-1', text: 'Budget (Q3)', discussed: false, position: 0 }])

    await userEvent.click(screen.getByTestId('agenda-item-check'))

    await waitFor(() => expect(screen.getByTestId('agenda-item-check')).not.toBeChecked())
    expect(screen.getByTestId('agenda-coverage')).toHaveTextContent('0 / 1')
  })

  it('edits an item text inline and patches optimistically', async () => {
    let put: { itemId?: string; text?: string } = {}
    server.use(
      http.put(`/api/notes/${NOTE_ID}/agenda-items/:itemId`, async ({ params, request }) => {
        put = { itemId: params.itemId as string, text: ((await request.json()) as { text: string }).text }
        return new HttpResponse(null, { status: 204 })
      }),
      http.get(`/api/notes/${NOTE_ID}`, () =>
        HttpResponse.json(noteWith([{ itemId: 'i-1', text: 'Budget (Q3)', discussed: false, position: 0 }]))),
    )
    renderAgenda([{ itemId: 'i-1', text: 'Budget', discussed: false, position: 0 }])

    await userEvent.click(screen.getByTestId('agenda-item-text'))
    const input = screen.getByTestId('agenda-item-edit-input')
    await userEvent.clear(input)
    await userEvent.type(input, 'Budget (Q3){Enter}')

    // Optimistic: the new text shows immediately; the PUT carried the trimmed text.
    expect(await screen.findByText('Budget (Q3)')).toBeInTheDocument()
    await waitFor(() => expect(put).toEqual({ itemId: 'i-1', text: 'Budget (Q3)' }))
  })

  it('does not send an edit when the text is unchanged', async () => {
    let putCalled = false
    server.use(
      http.put(`/api/notes/${NOTE_ID}/agenda-items/:itemId`, () => {
        putCalled = true
        return new HttpResponse(null, { status: 204 })
      }),
    )
    renderAgenda([{ itemId: 'i-1', text: 'Budget', discussed: false, position: 0 }])

    await userEvent.click(screen.getByTestId('agenda-item-text'))
    const input = screen.getByTestId('agenda-item-edit-input')
    await userEvent.type(input, '{Enter}') // commit unchanged

    expect(putCalled).toBe(false)
    expect(screen.getByTestId('agenda-item-text')).toHaveTextContent('Budget')
  })

  it('removes an item optimistically', async () => {
    let deleted = false
    server.use(
      http.delete(`/api/notes/${NOTE_ID}/agenda-items/:itemId`, () => {
        deleted = true
        return new HttpResponse(null, { status: 204 })
      }),
      http.get(`/api/notes/${NOTE_ID}`, () =>
        HttpResponse.json(noteWith([{ itemId: 'i-2', text: 'Keep', discussed: false, position: 1 }]))),
    )
    renderAgenda([
      { itemId: 'i-1', text: 'Drop', discussed: false, position: 0 },
      { itemId: 'i-2', text: 'Keep', discussed: false, position: 1 },
    ])

    await userEvent.click(screen.getByRole('button', { name: 'Remove "Drop"' }))

    // Optimistic: the dropped item disappears immediately, the kept one stays.
    await waitFor(() => expect(screen.queryByText('Drop')).not.toBeInTheDocument())
    expect(screen.getByText('Keep')).toBeInTheDocument()
    await waitFor(() => expect(deleted).toBe(true))
  })

  it('removing a ticked item drops the covered count', async () => {
    server.use(
      http.delete(`/api/notes/${NOTE_ID}/agenda-items/:itemId`, () => new HttpResponse(null, { status: 204 })),
      http.get(`/api/notes/${NOTE_ID}`, () =>
        HttpResponse.json(noteWith([{ itemId: 'i-2', text: 'B', discussed: false, position: 1 }]))),
    )
    renderAgenda([
      { itemId: 'i-1', text: 'A', discussed: true, position: 0 },
      { itemId: 'i-2', text: 'B', discussed: false, position: 1 },
    ])
    expect(screen.getByTestId('agenda-coverage')).toHaveTextContent('1 / 2')

    await userEvent.click(screen.getByRole('button', { name: 'Remove "A"' }))

    await waitFor(() => expect(screen.getByTestId('agenda-coverage')).toHaveTextContent('0 / 1'))
  })

  it('is expanded by default — items and the add field are visible, no peek', () => {
    renderAgenda([{ itemId: 'i-1', text: 'Budget', discussed: false, position: 0 }])
    expect(screen.getByTestId('agenda-body')).toBeInTheDocument()
    expect(screen.getByTestId('agenda-add-input')).toBeInTheDocument()
    expect(screen.queryByTestId('agenda-peek')).toBeNull()
    expect(screen.getByTestId('agenda-toggle')).toHaveAttribute('aria-expanded', 'true')
  })

  it('collapses to one line showing coverage + the remaining items, then expands again', async () => {
    renderAgenda([
      { itemId: 'i-1', text: 'Budget', discussed: true, position: 0 },
      { itemId: 'i-2', text: 'Hiring', discussed: false, position: 1 },
      { itemId: 'i-3', text: 'Roadmap', discussed: false, position: 2 },
    ])

    await userEvent.click(screen.getByTestId('agenda-toggle'))

    // Collapsed: body (items + add field) hidden; coverage + remaining-items peek shown on one line.
    expect(screen.queryByTestId('agenda-body')).toBeNull()
    expect(screen.queryByTestId('agenda-add-input')).toBeNull()
    expect(screen.getByTestId('agenda-coverage')).toHaveTextContent('1 / 3')
    expect(screen.getByTestId('agenda-peek')).toHaveTextContent('left: Hiring, Roadmap')
    expect(screen.getByTestId('agenda-toggle')).toHaveAttribute('aria-expanded', 'false')

    await userEvent.click(screen.getByTestId('agenda-toggle'))

    expect(screen.getByTestId('agenda-body')).toBeInTheDocument()
    expect(screen.queryByTestId('agenda-peek')).toBeNull()
  })

  it('peek reads "all covered" when every item is ticked', async () => {
    renderAgenda([{ itemId: 'i-1', text: 'Budget', discussed: true, position: 0 }])
    await userEvent.click(screen.getByTestId('agenda-toggle'))
    expect(screen.getByTestId('agenda-peek')).toHaveTextContent('all covered')
  })

  it('shows no collapse toggle when the agenda is empty', () => {
    renderAgenda([])
    expect(screen.queryByTestId('agenda-toggle')).toBeNull()
    expect(screen.getByTestId('agenda-add-input')).toBeInTheDocument()
  })
})

// 43-G: a derived topic is a task-list line in the note, so the header now edits that line through
// the editor rather than the API. 43-F made these controls read-only as a stopgap because the
// agenda-item endpoints would 404 on a topic with no event stream; this slice replaces that with a
// real write path, so the assertions it added are deliberately inverted here.
describe('AgendaSection — topics derived from the note body', () => {
  function editorStub() {
    return {
      addTopic: vi.fn(),
      setTopicChecked: vi.fn(),
      setTopicText: vi.fn(),
      removeTopic: vi.fn(),
    }
  }

  function renderWithEditor(agenda: NoteDetail['agenda'], editor: ReturnType<typeof editorStub> | null) {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } })
    qc.setQueryData(keys.note(NOTE_ID), noteWith(agenda))
    const Wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    )
    return rtlRender(<AgendaSection noteId={NOTE_ID} editor={editor} />, { wrapper: Wrapper })
  }

  const derived = (over: Partial<NonNullable<NoteDetail['agenda']>[number]> = {}) => ({
    itemId: 'd-1', text: 'Budget (Q3)', discussed: false, position: 0, derived: true, ...over,
  })

  it('counts a derived topic in the coverage pill', () => {
    renderWithEditor([
      derived({ itemId: 'd-1', discussed: true }),
      derived({ itemId: 'd-2', text: 'Hiring plan', position: 1 }),
    ], editorStub())
    expect(screen.getByTestId('agenda-coverage').textContent).toContain('1')
    expect(screen.getByTestId('agenda-coverage').textContent).toContain('2')
  })

  it('ticking a derived topic edits its line in the note, not the API', async () => {
    const user = userEvent.setup()
    const editor = editorStub()
    renderWithEditor([derived()], editor)

    await user.click(screen.getByTestId('agenda-item-check'))

    expect(editor.setTopicChecked).toHaveBeenCalledWith(0, true)
  })

  it('removing a derived topic deletes its line from the note', async () => {
    const user = userEvent.setup()
    const editor = editorStub()
    renderWithEditor([derived({ position: 2 })], editor)

    await user.click(screen.getByTestId('agenda-item-remove'))

    expect(editor.removeTopic).toHaveBeenCalledWith(2)
  })

  it('rewording a derived topic rewrites its line in the note', async () => {
    const user = userEvent.setup()
    const editor = editorStub()
    renderWithEditor([derived()], editor)

    await user.click(screen.getByTestId('agenda-item-text'))
    const input = screen.getByTestId('agenda-item-edit-input')
    await user.clear(input)
    await user.type(input, 'Q3 budget review{Enter}')

    expect(editor.setTopicText).toHaveBeenCalledWith(0, 'Q3 budget review')
  })

  it('adding a topic writes a line into the note', async () => {
    const user = userEvent.setup()
    const editor = editorStub()
    renderWithEditor([], editor)

    await user.type(screen.getByTestId('agenda-add-input'), 'On-call rotation{Enter}')

    expect(editor.addTopic).toHaveBeenCalledWith('On-call rotation')
  })

  // The editor is lazy-loaded, so there is a window where the strip is on screen and there is
  // nothing to write to. Controls disable rather than silently no-op or 404.
  it('disables derived controls while the editor has not loaded', () => {
    renderWithEditor([derived()], null)
    expect(screen.getByTestId('agenda-item-check')).toBeDisabled()
    expect(screen.getByTestId('agenda-item-text')).toBeDisabled()
    expect(screen.queryByTestId('agenda-item-remove')).toBeNull()
  })

  it('still allows editing a legacy (non-derived) topic through the API', async () => {
    const user = userEvent.setup()
    renderWithEditor([{ itemId: 'i-1', text: 'Budget (Q3)', discussed: false, position: 0 }], editorStub())
    expect(screen.getByTestId('agenda-item-check')).not.toBeDisabled()
    await user.click(screen.getByTestId('agenda-item-text'))
    expect(screen.getByTestId('agenda-item-edit-input')).toBeInTheDocument()
  })
})
