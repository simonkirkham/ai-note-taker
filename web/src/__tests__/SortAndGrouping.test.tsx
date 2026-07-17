import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { useEffect } from 'react'
import { MemoryRouter, useLocation } from 'react-router'
import type { NoteCard } from '../api/notes'
import ListView from '../components/ListView'
import { localDateISO } from '../dates'
import { render, renderWithRouter, screen, waitFor, within } from '../test/render'
import { server } from '../test/setup'

// 40-B: an explicit sort control (Newest / Oldest / Title A–Z / Z–A) persisted
// in ?sort=, and month grouping when the list is date-sorted across a wide span.
// Dates are relative to the real "today" so nothing becomes a time-bomb.

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

function renderHome(cards: NoteCard[], extra: Record<string, unknown> = {}) {
  return renderWithRouter(
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

let lastSearch = ''
function LocationProbe() {
  const search = useLocation().search
  useEffect(() => {
    lastSearch = search
  }, [search])
  return null
}

function renderHomeRouter(
  cards: NoteCard[],
  { entries = ['/'], ...extra }: { entries?: string[] } & Record<string, unknown> = {},
) {
  lastSearch = ''
  return render(
    <MemoryRouter initialEntries={entries}>
      <LocationProbe />
      <ListView
        cards={cards}
        loading={false}
        creating={false}
        createError={null}
        onNewNote={() => {}}
        onEditNote={() => {}}
        onOpenNote={() => {}}
        {...extra}
      />
    </MemoryRouter>,
  )
}

function cardTitlesInOrder(): string[] {
  const container = screen.getByTestId('note-cards')
  return within(container)
    .getAllByRole('heading', { level: 3 })
    .map((h) => h.textContent ?? '')
}

function sortSelect() {
  return screen.getByTestId('sort-select')
}

// Three notes inside the default 30-day window with distinct dates + titles.
function recentCards(): NoteCard[] {
  return [
    makeCard({ noteId: 'b', title: 'Banana', date: plusDays(-1), lastModifiedAt: isoAtLocalNoon(-1) }),
    makeCard({ noteId: 'a', title: 'apple', date: plusDays(0) }),
    makeCard({ noteId: 'c', title: 'Cherry', date: plusDays(-2), lastModifiedAt: isoAtLocalNoon(-2) }),
  ]
}

describe('40-B — sort control', () => {
  it('defaults to newest first', () => {
    renderHome(recentCards())
    expect(sortSelect()).toHaveValue('date-desc')
    expect(cardTitlesInOrder()).toEqual(['apple', 'Banana', 'Cherry'])
  })

  it('sorts by date, oldest first', async () => {
    renderHome(recentCards())
    await userEvent.selectOptions(sortSelect(), 'date-asc')
    expect(cardTitlesInOrder()).toEqual(['Cherry', 'Banana', 'apple'])
  })

  it('sorts by title A–Z, case-insensitively', async () => {
    renderHome(recentCards())
    await userEvent.selectOptions(sortSelect(), 'title-asc')
    expect(cardTitlesInOrder()).toEqual(['apple', 'Banana', 'Cherry'])
  })

  it('sorts by title Z–A, case-insensitively', async () => {
    renderHome(recentCards())
    await userEvent.selectOptions(sortSelect(), 'title-desc')
    expect(cardTitlesInOrder()).toEqual(['Cherry', 'Banana', 'apple'])
  })

  it('writes ?sort for a non-default order and clears it for newest-first', async () => {
    renderHomeRouter(recentCards())
    await userEvent.selectOptions(sortSelect(), 'title-asc')
    await waitFor(() => expect(new URLSearchParams(lastSearch).get('sort')).toBe('title-asc'))
    await userEvent.selectOptions(sortSelect(), 'date-desc')
    await waitFor(() => expect(new URLSearchParams(lastSearch).get('sort')).toBeNull())
  })

  it('restores the sort order from ?sort on mount', () => {
    renderHomeRouter(recentCards(), { entries: ['/?sort=date-asc'] })
    expect(sortSelect()).toHaveValue('date-asc')
    expect(cardTitlesInOrder()).toEqual(['Cherry', 'Banana', 'apple'])
  })

  it('composes the sort with a date range and tag filter (filter then sort)', async () => {
    server.use(
      http.get('/api/tags', () =>
        HttpResponse.json({ tags: [{ tag: 'work', noteCount: 2, noteIds: ['w1', 'w2'] }] }),
      ),
    )
    renderHome([
      makeCard({ noteId: 'w1', title: 'Zeta work', date: plusDays(0), tags: ['work'] }),
      makeCard({ noteId: 'w2', title: 'Alpha work', date: plusDays(-3), lastModifiedAt: isoAtLocalNoon(-3), tags: ['work'] }),
      makeCard({ noteId: 'x', title: 'Other', date: plusDays(0), tags: [] }),
    ])
    // Filter to the "work" tag, then sort by title.
    await userEvent.click(screen.getByRole('button', { name: /^filters/i }))
    await userEvent.click(await screen.findByTestId('tag-filter-pill-work'))
    await userEvent.selectOptions(sortSelect(), 'title-asc')
    await waitFor(() => expect(screen.queryByText('Other')).not.toBeInTheDocument())
    expect(cardTitlesInOrder()).toEqual(['Alpha work', 'Zeta work'])
  })

  it('is hidden while searching', async () => {
    server.use(
      http.get('/api/notes/search', () => HttpResponse.json({ items: [] })),
    )
    renderHome(recentCards())
    await userEvent.type(screen.getByRole('searchbox', { name: /search notes/i }), 'plan')
    await waitFor(() => expect(screen.queryByTestId('sort-select')).not.toBeInTheDocument())
  })
})

describe('40-B — month grouping', () => {
  // A note today and one ~200 days ago: a wide span for a date sort.
  function wideCards(): NoteCard[] {
    return [
      makeCard({ noteId: 't', title: 'Today note', date: plusDays(0) }),
      makeCard({ noteId: 'o', title: 'Old note', date: plusDays(-200), lastModifiedAt: isoAtLocalNoon(-200) }),
    ]
  }

  async function selectRangeAll() {
    await userEvent.click(screen.getByRole('button', { name: /^filters/i }))
    await userEvent.click(screen.getByTestId('range-preset-all'))
  }

  it('groups by month on a wide, date-sorted range', async () => {
    renderHome(wideCards())
    await selectRangeAll()
    // Both notes now visible across a wide span → month headers appear.
    expect(await screen.findByText('Old note')).toBeInTheDocument()
    expect(screen.getAllByTestId('month-header').length).toBeGreaterThanOrEqual(2)
  })

  it('does not group on the short default window', () => {
    renderHome([
      makeCard({ noteId: 'a', title: 'A', date: plusDays(0) }),
      makeCard({ noteId: 'b', title: 'B', date: plusDays(-5), lastModifiedAt: isoAtLocalNoon(-5) }),
    ])
    expect(screen.queryByTestId('month-header')).not.toBeInTheDocument()
  })

  it('does not group when sorted by title, even across a wide range', async () => {
    renderHome(wideCards())
    await selectRangeAll()
    expect(await screen.findByText('Old note')).toBeInTheDocument()
    await userEvent.selectOptions(sortSelect(), 'title-asc')
    await waitFor(() =>
      expect(screen.queryByTestId('month-header')).not.toBeInTheDocument(),
    )
  })
})
