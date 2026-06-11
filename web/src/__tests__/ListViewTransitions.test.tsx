import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import type { NoteCard } from '../api/notes'
import ListView from '../components/ListView'
import { localDateISO } from '../dates'
import { render, screen, waitFor } from '../test/render'
import { server } from '../test/setup'

// 19-I3: deferring the search query (useDeferredValue) must not regress the
// user-facing contract — the input value reflects each keystroke immediately,
// and the filtered list eventually catches up to the (deferred) query.

function plusDays(delta: number): string {
  const d = new Date()
  d.setDate(d.getDate() + delta)
  return localDateISO(d)
}

function isoAtLocalNoon(delta: number): string {
  const d = new Date()
  d.setDate(d.getDate() + delta)
  d.setHours(12, 0, 0, 0)
  return d.toISOString()
}

function makeCard(
  overrides: Partial<NoteCard> & { noteId: string; title: string },
): NoteCard {
  return {
    contentPreview: '',
    date: plusDays(0),
    openActions: [],
    createdAt: isoAtLocalNoon(0),
    lastModifiedAt: isoAtLocalNoon(0),
    tags: [],
    folderId: null,
    ...overrides,
  }
}

function searchReturns(
  items: {
    noteId: string
    title: string
    snippet: string
    score: number
    matchedField: string
  }[],
) {
  server.use(
    http.get('/api/notes/search', () => HttpResponse.json({ items })),
  )
}

function renderHome(cards: NoteCard[]) {
  return render(
    <ListView
      cards={cards}
      loading={false}
      creating={false}
      createError={null}
      onNewNote={() => {}}
      onEditNote={() => {}}
      onOpenNote={() => {}}
    />,
  )
}

function searchBox() {
  return screen.getByRole('searchbox', { name: /search notes/i })
}

describe('ListView — non-urgent transitions (19-I3)', () => {
  it('reflects each keystroke in the input value immediately', async () => {
    searchReturns([
      { noteId: 'b', title: 'Budget review', snippet: 's', score: 90, matchedField: 'title' },
    ])
    renderHome([makeCard({ noteId: 'b', title: 'Budget review' })])
    const box = searchBox()
    await userEvent.type(box, 'budget')
    // The bound input value tracks the live query, never the deferred copy.
    expect(box).toHaveValue('budget')
  })

  it('eventually filters the list to match the typed query', async () => {
    searchReturns([
      { noteId: 'b', title: 'Budget review', snippet: 'the budget review', score: 90, matchedField: 'title' },
    ])
    renderHome([
      makeCard({ noteId: 'b', title: 'Budget review' }),
      makeCard({ noteId: 'x', title: 'Other note' }),
    ])
    await userEvent.type(searchBox(), 'budget')
    expect(await screen.findByText('Budget review')).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.queryByText('Other note')).not.toBeInTheDocument(),
    )
  })

  it('clearing the box restores the unsearched list', async () => {
    searchReturns([
      { noteId: 'b', title: 'Budget review', snippet: 's', score: 90, matchedField: 'title' },
    ])
    renderHome([
      makeCard({ noteId: 'b', title: 'Budget review' }),
      makeCard({ noteId: 'x', title: 'Other note' }),
    ])
    await userEvent.type(searchBox(), 'budget')
    await waitFor(() =>
      expect(screen.queryByText('Other note')).not.toBeInTheDocument(),
    )
    await userEvent.click(screen.getByRole('button', { name: /clear search/i }))
    expect(await screen.findByText('Other note')).toBeInTheDocument()
    expect(searchBox()).toHaveValue('')
  })
})
