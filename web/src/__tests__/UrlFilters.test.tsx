import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { useEffect } from 'react'
import { MemoryRouter, useLocation } from 'react-router'
import type { NoteCard } from '../api/notes'
import ListView from '../components/ListView'
import { localDateISO } from '../dates'
import { render, screen, waitFor, within } from '../test/render'
import { server } from '../test/setup'

// CHANGE-23: the home list filters (search query, selected tags, AND/OR mode,
// show-older) live in the URL query string, so navigating into a note and
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

  it('restores show-older from ?older=1', async () => {
    renderHome(
      [
        makeCard({
          noteId: 'old',
          title: 'Old note',
          date: plusDays(-10),
          createdAt: isoAtLocalNoon(-10),
          lastModifiedAt: isoAtLocalNoon(-10),
        }),
      ],
      { entries: ['/?older=1'] },
    )

    expect(await screen.findByText('Old note')).toBeInTheDocument()
  })

  it('hides older notes without ?older (baseline)', async () => {
    renderHome([
      makeCard({
        noteId: 'old',
        title: 'Old note',
        date: plusDays(-10),
        createdAt: isoAtLocalNoon(-10),
        lastModifiedAt: isoAtLocalNoon(-10),
      }),
    ])

    expect(screen.queryByText('Old note')).not.toBeInTheDocument()
  })
})
