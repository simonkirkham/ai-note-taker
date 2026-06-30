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
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
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
    const items = screen.getAllByTestId('agenda-item')
    expect(items.map((i) => i.textContent)).toEqual(['Budget (Q3)', 'Hiring backfill'])
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
})
