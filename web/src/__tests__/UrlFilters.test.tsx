import userEvent from '@testing-library/user-event'
import { fireEvent } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { useEffect } from 'react'
import { MemoryRouter, useLocation } from 'react-router'
import type { NoteCard } from '../api/notes'
import ListView from '../components/ListView'
import { localDateISO } from '../dates'
import { render, screen, waitFor, within } from '../test/render'
import { server } from '../test/setup'

// CHANGE-23 + 40-A: the home list filters (search query, selected tags, AND/OR
// mode, date range) live in the URL query string, so navigating into a note and
// pressing Back restores them. These specs prove the URL is the source of truth
// both directions: filters are read from the URL on mount, and writing a filter
// updates the URL.

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
  server.use(http.get('/api/notes/search', () => HttpResponse.json({ items })))
}

function tagsReturn(tags: string[]) {
  server.use(
    http.get('/api/tags', () =>
      HttpResponse.json({
        tags: tags.map((tag) => ({ tag, noteCount: 1, noteIds: [] })),
      }),
    ),
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

function renderHome(
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

function searchBox() {
  return screen.getByRole('searchbox', { name: /search notes/i })
}

async function openFilters() {
  await userEvent.click(screen.getByRole('button', { name: /^filters/i }))
}

describe('CHANGE-23 — home filters persist in the URL', () => {
  it('restores the search query from ?q on mount', async () => {
    searchReturns([
      {
        noteId: 'b',
        title: 'Budget review',
        snippet: 'the budget',
        score: 1,
        matchedField: 'content',
      },
    ])
    renderHome([makeCard({ noteId: 'b', title: 'Budget review' })], {
      entries: ['/?q=budget'],
    })

    expect(searchBox()).toHaveValue('budget')
    await waitFor(() =>
      expect(screen.getByText(/budget review/i)).toBeInTheDocument(),
    )
  })

  it('writes the search query to ?q as the user types', async () => {
    searchReturns([])
    renderHome([makeCard({ noteId: 'a', title: 'Today note' })])

    await userEvent.type(searchBox(), 'plan')

    await waitFor(() =>
      expect(new URLSearchParams(lastSearch).get('q')).toBe('plan'),
    )
  })

  it('restores selected tags from ?tag on mount', async () => {
    renderHome(
      [
        makeCard({ noteId: 'w', title: 'Work note', tags: ['work'] }),
        makeCard({ noteId: 'p', title: 'Personal note', tags: ['personal'] }),
      ],
      { entries: ['/?tag=work'] },
    )

    const cards = await screen.findByTestId('note-cards')
    expect(within(cards).getByText('Work note')).toBeInTheDocument()
    expect(within(cards).queryByText('Personal note')).not.toBeInTheDocument()
  })

  it('writes a toggled tag to ?tag', async () => {
    tagsReturn(['work'])
    renderHome([makeCard({ noteId: 'w', title: 'Work note', tags: ['work'] })])

    await openFilters()
    await userEvent.click(await screen.findByTestId('tag-filter-pill-work'))

    await waitFor(() =>
      expect(new URLSearchParams(lastSearch).getAll('tag')).toContain('work'),
    )
  })

  it('writes the AND/OR mode to ?mode when toggled', async () => {
    tagsReturn(['a', 'b'])
    renderHome([
      makeCard({ noteId: 'a', title: 'Alpha', tags: ['a'] }),
      makeCard({ noteId: 'b', title: 'Beta', tags: ['b'] }),
    ])

    await openFilters()
    // The AND/OR toggle only renders once 2+ tags are selected.
    await userEvent.click(await screen.findByTestId('tag-filter-pill-a'))
    await userEvent.click(await screen.findByTestId('tag-filter-pill-b'))
    await userEvent.click(await screen.findByTestId('tag-filter-mode-toggle'))

    await waitFor(() =>
      expect(new URLSearchParams(lastSearch).get('mode')).toBe('OR'),
    )
  })

  it('writes ?range when a non-default preset is picked', async () => {
    renderHome([makeCard({ noteId: 'a', title: 'Today note' })])

    await openFilters()
    await userEvent.click(await screen.findByTestId('range-preset-today'))

    await waitFor(() =>
      expect(new URLSearchParams(lastSearch).get('range')).toBe('today'),
    )
  })

  it('writes ?from and ?to for a custom range and drops ?range', async () => {
    renderHome([makeCard({ noteId: 'a', title: 'Today note' })])

    await openFilters()
    await userEvent.click(await screen.findByTestId('range-preset-custom'))
    fireEvent.change(screen.getByTestId('range-from'), { target: { value: plusDays(-10) } })
    fireEvent.change(screen.getByTestId('range-to'), { target: { value: plusDays(-5) } })

    await waitFor(() => {
      const params = new URLSearchParams(lastSearch)
      expect(params.get('from')).toBe(plusDays(-10))
      expect(params.get('to')).toBe(plusDays(-5))
      expect(params.get('range')).toBeNull()
    })
  })

  it('does not write ?range for the default Last 30 days preset', async () => {
    renderHome([makeCard({ noteId: 'a', title: 'Today note' })])

    await openFilters()
    await userEvent.click(await screen.findByTestId('range-preset-all'))
    await waitFor(() =>
      expect(new URLSearchParams(lastSearch).get('range')).toBe('all'),
    )
    await userEvent.click(screen.getByTestId('range-preset-30'))
    await waitFor(() =>
      expect(new URLSearchParams(lastSearch).get('range')).toBeNull(),
    )
  })

  it('applying a tag does not touch the date range (CHANGE-19 retired)', async () => {
    tagsReturn(['work'])
    renderHome([makeCard({ noteId: 'w', title: 'Work note', tags: ['work'] })])

    await openFilters()
    await userEvent.click(await screen.findByTestId('tag-filter-pill-work'))

    await waitFor(() => {
      const params = new URLSearchParams(lastSearch)
      expect(params.getAll('tag')).toContain('work')
      expect(params.get('range')).toBeNull()
      expect(params.get('older')).toBeNull()
    })
  })

  it('restores AND/OR mode from ?mode (OR widens the match)', async () => {
    renderHome(
      [
        makeCard({ noteId: 'a', title: 'Alpha', tags: ['a'] }),
        makeCard({ noteId: 'b', title: 'Beta', tags: ['b'] }),
      ],
      { entries: ['/?tag=a&tag=b&mode=OR'] },
    )

    const cards = await screen.findByTestId('note-cards')
    expect(within(cards).getByText('Alpha')).toBeInTheDocument()
    expect(within(cards).getByText('Beta')).toBeInTheDocument()
  })

  it('restores a wide range from ?range=all', async () => {
    renderHome(
      [
        makeCard({
          noteId: 'old',
          title: 'Old note',
          date: plusDays(-200),
          createdAt: isoAtLocalNoon(-200),
          lastModifiedAt: isoAtLocalNoon(-200),
        }),
      ],
      { entries: ['/?range=all'] },
    )

    expect(await screen.findByText('Old note')).toBeInTheDocument()
  })

  it('restores a custom range from ?from&?to', async () => {
    renderHome(
      [
        makeCard({ noteId: 'in', title: 'In range', date: plusDays(-7), lastModifiedAt: isoAtLocalNoon(-7) }),
        makeCard({ noteId: 'out', title: 'Out of range', date: plusDays(0) }),
      ],
      { entries: [`/?from=${plusDays(-10)}&to=${plusDays(-5)}`] },
    )

    expect(await screen.findByText('In range')).toBeInTheDocument()
    expect(screen.queryByText('Out of range')).not.toBeInTheDocument()
  })

  it('shows the last 30 days by default and hides >30-day-old notes (baseline)', async () => {
    renderHome([
      makeCard({ noteId: 'recent', title: 'Recent note', date: plusDays(-10), lastModifiedAt: isoAtLocalNoon(-10) }),
      makeCard({
        noteId: 'old',
        title: 'Old note',
        date: plusDays(-40),
        createdAt: isoAtLocalNoon(-40),
        lastModifiedAt: isoAtLocalNoon(-40),
      }),
    ])

    expect(await screen.findByText('Recent note')).toBeInTheDocument()
    expect(screen.queryByText('Old note')).not.toBeInTheDocument()
  })
})
