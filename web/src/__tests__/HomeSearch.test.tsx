import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import type { NoteCard } from '../api/notes'
import ListView from '../components/ListView'
import { localDateISO } from '../dates'
import { render, screen, waitFor } from '../test/render'
import { server } from '../test/setup'

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

interface SearchItem {
  noteId: string
  title: string
  snippet: string
  score: number
  matchedField: string
  matchedTerms?: string[]
}

function searchReturns(items: SearchItem[]) {
  server.use(
    http.get('/api/notes/search', () => HttpResponse.json({ items })),
  )
}

function renderHome(cards: NoteCard[], extra: Record<string, unknown> = {}) {
  return render(
    <ListView
      cards={cards}
      loading={false}
      creating={false}
      createError={null}
      onNewNote={() => {}}
      onEditNote={() => {}}
      onOpenNote={() => {}}
      {...extra}
    />,
  )
}

function searchBox() {
  return screen.getByRole('searchbox', { name: /search notes/i })
}

async function typeQuery(text: string) {
  await userEvent.type(searchBox(), text)
}

describe('Home search bar (22-B)', () => {
  it('shows the search box on the home view', () => {
    renderHome([makeCard({ noteId: 'a', title: 'Today note' })])
    expect(searchBox()).toBeInTheDocument()
  })

  it('does not show the search box in folder view', () => {
    renderHome(
      [makeCard({ noteId: 'p', title: 'In folder', folderId: 'f-1' })],
      { currentFolderId: 'f-1' },
    )
    expect(screen.queryByRole('searchbox', { name: /search notes/i })).not.toBeInTheDocument()
  })

  it('typing shows matching notes as cards and a match count', async () => {
    searchReturns([
      { noteId: 'b', title: 'Budget review', snippet: 'the budget review', score: 90, matchedField: 'title' },
    ])
    renderHome([
      makeCard({ noteId: 'b', title: 'Budget review' }),
      makeCard({ noteId: 'x', title: 'Other note' }),
    ])
    await typeQuery('budget')
    expect(await screen.findByText('Budget review')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByText('Other note')).not.toBeInTheDocument())
    expect(screen.getByText(/1 match/i)).toBeInTheDocument()
  })

  it('result card shows the matched snippet as its preview', async () => {
    searchReturns([
      { noteId: 'b', title: 'Budget review', snippet: 'around the budget figure', score: 90, matchedField: 'body' },
    ])
    renderHome([makeCard({ noteId: 'b', title: 'Budget review', contentPreview: 'static preview' })])
    await typeQuery('budget')
    expect(await screen.findByText('around the budget figure')).toBeInTheDocument()
    expect(screen.queryByText('static preview')).not.toBeInTheDocument()
  })

  it('debounces: rapid typing issues a single request', async () => {
    let calls = 0
    server.use(
      http.get('/api/notes/search', () => {
        calls += 1
        return HttpResponse.json({ items: [] })
      }),
    )
    renderHome([makeCard({ noteId: 'a', title: 'Today note' })])
    await typeQuery('budget')
    await waitFor(() => expect(calls).toBeGreaterThan(0))
    // settle window passed; rapid keystrokes collapsed to one request
    await new Promise((r) => setTimeout(r, 400))
    expect(calls).toBe(1)
  })

  it('shows an explicit no-matches state distinct from error', async () => {
    searchReturns([])
    renderHome([makeCard({ noteId: 'a', title: 'Today note' })])
    await typeQuery('zzzzz')
    expect(await screen.findByText(/no matching notes/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument()
  })

  it('shows an error state with Retry on failure, never "no matches"', async () => {
    server.use(
      http.get('/api/notes/search', () => new HttpResponse(null, { status: 500 })),
    )
    renderHome([makeCard({ noteId: 'a', title: 'Today note' })])
    await typeQuery('budget')
    expect(await screen.findByRole('button', { name: /retry/i })).toBeInTheDocument()
    expect(screen.queryByText(/no matching notes/i)).not.toBeInTheDocument()
  })

  it('clearing the box restores the prior view', async () => {
    searchReturns([
      { noteId: 'b', title: 'Budget review', snippet: 's', score: 90, matchedField: 'title' },
    ])
    renderHome([
      makeCard({ noteId: 'b', title: 'Budget review' }),
      makeCard({ noteId: 'x', title: 'Other note' }),
    ])
    await typeQuery('budget')
    await waitFor(() => expect(screen.queryByText('Other note')).not.toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: /clear search/i }))
    expect(await screen.findByText('Other note')).toBeInTheDocument()
    expect(screen.getByText('Budget review')).toBeInTheDocument()
  })

  it('suspends the filters while a query is active', async () => {
    searchReturns([
      { noteId: 'b', title: 'Budget review', snippet: 's', score: 90, matchedField: 'title' },
    ])
    renderHome([makeCard({ noteId: 'b', title: 'Budget review' })])
    await typeQuery('budget')
    expect(await screen.findByText(/filters paused while searching/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^filters/i })).toBeDisabled()
  })

  it('discards stale responses — the latest query wins', async () => {
    // First request (slow) resolves AFTER the second (fast). Latest must win.
    let call = 0
    server.use(
      http.get('/api/notes/search', async () => {
        call += 1
        if (call === 1) {
          await new Promise((r) => setTimeout(r, 200))
          return HttpResponse.json({
            items: [{ noteId: 'a', title: 'Alpha stale', snippet: 's', score: 50, matchedField: 'title' }],
          })
        }
        return HttpResponse.json({
          items: [{ noteId: 'b', title: 'Beta fresh', snippet: 's', score: 90, matchedField: 'title' }],
        })
      }),
    )
    renderHome([
      makeCard({ noteId: 'a', title: 'Alpha stale' }),
      makeCard({ noteId: 'b', title: 'Beta fresh' }),
    ])
    // Type "a", wait the debounce so request 1 fires, then change to "ab" so
    // request 2 fires and resolves first.
    await userEvent.type(searchBox(), 'a')
    await new Promise((r) => setTimeout(r, 350))
    await userEvent.type(searchBox(), 'b')
    expect(await screen.findByText('Beta fresh')).toBeInTheDocument()
    // Give the slow request time to resolve; it must not overwrite.
    await new Promise((r) => setTimeout(r, 300))
    expect(screen.getByText('Beta fresh')).toBeInTheDocument()
    expect(screen.queryByText('Alpha stale')).not.toBeInTheDocument()
  })

  it('highlights the matched term in the title', async () => {
    searchReturns([
      { noteId: 'b', title: 'Budget review', snippet: 's', score: 90, matchedField: 'title', matchedTerms: ['Budget'] },
    ])
    renderHome([makeCard({ noteId: 'b', title: 'Budget review' })])
    await typeQuery('budget')
    const title = await screen.findByTestId('note-card-title')
    const mark = title.querySelector('mark')
    expect(mark).not.toBeNull()
    expect(mark!.textContent).toBe('Budget')
  })

  it('highlights the matched term in the snippet', async () => {
    searchReturns([
      { noteId: 'b', title: 'Plan note', snippet: 'we discussed planning at length', score: 90, matchedField: 'notes', matchedTerms: ['planning'] },
    ])
    renderHome([makeCard({ noteId: 'b', title: 'Plan note' })])
    await typeQuery('planing')
    const mark = await screen.findByText('planning', { selector: 'mark' })
    expect(mark).toBeInTheDocument()
  })

  it('highlights a matching tag pill', async () => {
    searchReturns([
      { noteId: 'b', title: 'Tagged note', snippet: 's', score: 90, matchedField: 'tag', matchedTerms: ['roadmap'] },
    ])
    renderHome([makeCard({ noteId: 'b', title: 'Tagged note', tags: ['roadmap', 'other'] })])
    await typeQuery('roadmap')
    const pill = await screen.findByTestId('card-tag-roadmap')
    expect(pill.querySelector('mark')).not.toBeNull()
    expect(screen.getByTestId('card-tag-other').querySelector('mark')).toBeNull()
  })

  it('shows a "matched in" label', async () => {
    searchReturns([
      { noteId: 'b', title: 'Budget review', snippet: 's', score: 90, matchedField: 'tag', matchedTerms: ['roadmap'] },
    ])
    renderHome([makeCard({ noteId: 'b', title: 'Budget review', tags: ['roadmap'] })])
    await typeQuery('roadmap')
    expect(await screen.findByText(/matched in tag/i)).toBeInTheDocument()
  })

  it('renders no highlight markup on a non-search card', () => {
    renderHome([makeCard({ noteId: 'b', title: 'Budget review', contentPreview: 'budget budget' })])
    const title = screen.getByTestId('note-card-title')
    expect(title.querySelector('mark')).toBeNull()
  })

  it('renders a markup-bearing term as text, never injected markup (XSS-safe)', async () => {
    searchReturns([
      {
        noteId: 'b',
        title: 'safe <img src=x onerror=alert(1)> end',
        snippet: 's',
        score: 90,
        matchedField: 'title',
        matchedTerms: ['<img src=x onerror=alert(1)>'],
      },
    ])
    renderHome([makeCard({ noteId: 'b', title: 'safe <img src=x onerror=alert(1)> end' })])
    await typeQuery('img')
    const title = await screen.findByTestId('note-card-title')
    expect(title.querySelector('img')).toBeNull()
    expect(title.textContent).toContain('<img src=x onerror=alert(1)>')
  })

  it('clicking a result opens the note', async () => {
    const onOpenNote = vi.fn()
    const onEditNote = vi.fn()
    searchReturns([
      { noteId: 'b', title: 'Budget review', snippet: 's', score: 90, matchedField: 'title' },
    ])
    renderHome([makeCard({ noteId: 'b', title: 'Budget review' })], { onEditNote })
    await typeQuery('budget')
    const card = await screen.findByText('Budget review')
    await userEvent.click(card)
    expect(onEditNote).toHaveBeenCalledWith('b')
    expect(onOpenNote).not.toHaveBeenCalled()
  })
})
