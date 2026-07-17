import { fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import type { NoteCard } from '../api/notes'
import ListView from '../components/ListView'
import { localDateISO } from '../dates'
import { renderWithRouter as render, screen, waitFor, within } from '../test/render'
import { server } from '../test/setup'

// Build dates relative to the real "today" so the tests never become a
// time-bomb — the component uses the real clock and so do we.
function plusDays(delta: number): string {
  const d = new Date()
  d.setDate(d.getDate() + delta)
  return localDateISO(d)
}

// A timestamp whose *local* calendar date is today + delta (noon avoids
// timezone-edge flips).
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
    date: null,
    openActions: [],
    createdAt: isoAtLocalNoon(0),
    lastModifiedAt: isoAtLocalNoon(0),
    tags: [],
    folderId: null,
    ...overrides,
  }
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

async function openFilters() {
  const btn = screen.getByRole('button', { name: /^filters/i })
  if (btn.getAttribute('aria-expanded') !== 'true') {
    await userEvent.click(btn)
  }
}

// Expand the Filters panel and pick a date-range preset (40-A).
async function selectRange(id: string) {
  await openFilters()
  await userEvent.click(screen.getByTestId(`range-preset-${id}`))
}

function cardTitlesInOrder(): string[] {
  const container = screen.getByTestId('note-cards')
  return within(container)
    .getAllByRole('heading', { level: 3 })
    .map((h) => h.textContent ?? '')
}

describe('ListView — home default window + date-range filter (40-A)', () => {
  it('announces a create-note failure as an alert (19-F1)', () => {
    renderHome([], { createError: 'Could not create note. Please try again.' })
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Could not create note. Please try again.',
    )
  })

  it('shows the last 30 days by default and hides notes older than 30 days', () => {
    renderHome([
      makeCard({ noteId: 't', title: 'Today note', date: plusDays(0) }),
      makeCard({ noteId: 'r', title: 'Recent note', date: plusDays(-20), lastModifiedAt: isoAtLocalNoon(-20) }),
      makeCard({ noteId: 'o', title: 'Old note', date: plusDays(-40), lastModifiedAt: isoAtLocalNoon(-40) }),
    ])
    expect(screen.getByText('Today note')).toBeInTheDocument()
    expect(screen.getByText('Recent note')).toBeInTheDocument()
    expect(screen.queryByText('Old note')).not.toBeInTheDocument()
  })

  it('has no "show older" toggle anymore', async () => {
    renderHome([makeCard({ noteId: 't', title: 'Today note', date: plusDays(0) })])
    await openFilters()
    expect(
      screen.queryByRole('checkbox', { name: /show older notes/i }),
    ).not.toBeInTheDocument()
  })

  it('narrows to today with the Today preset', async () => {
    renderHome([
      makeCard({ noteId: 't', title: 'Today note', date: plusDays(0) }),
      makeCard({ noteId: 'r', title: 'Recent note', date: plusDays(-10), lastModifiedAt: isoAtLocalNoon(-10) }),
    ])
    expect(screen.getByText('Recent note')).toBeInTheDocument()
    await selectRange('today')
    expect(screen.getByText('Today note')).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.queryByText('Recent note')).not.toBeInTheDocument(),
    )
  })

  it('widens to every note with the All preset', async () => {
    renderHome([
      makeCard({ noteId: 't', title: 'Today note', date: plusDays(0) }),
      makeCard({ noteId: 'o', title: 'Old note', date: plusDays(-200), lastModifiedAt: isoAtLocalNoon(-200) }),
    ])
    expect(screen.queryByText('Old note')).not.toBeInTheDocument()
    await selectRange('all')
    expect(await screen.findByText('Old note')).toBeInTheDocument()
    expect(screen.getByText('Today note')).toBeInTheDocument()
  })

  it('filters to a custom from–to range', async () => {
    renderHome([
      makeCard({ noteId: 'in', title: 'In range', date: plusDays(-7), lastModifiedAt: isoAtLocalNoon(-7) }),
      makeCard({ noteId: 'before', title: 'Before range', date: plusDays(-20), lastModifiedAt: isoAtLocalNoon(-20) }),
      makeCard({ noteId: 'after', title: 'After range', date: plusDays(-1), lastModifiedAt: isoAtLocalNoon(-1) }),
    ])
    await openFilters()
    await userEvent.click(screen.getByTestId('range-preset-custom'))
    fireEvent.change(screen.getByTestId('range-from'), { target: { value: plusDays(-10) } })
    fireEvent.change(screen.getByTestId('range-to'), { target: { value: plusDays(-5) } })
    expect(await screen.findByText('In range')).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.queryByText('Before range')).not.toBeInTheDocument()
      expect(screen.queryByText('After range')).not.toBeInTheDocument()
    })
  })

  it('returns to the default window when the range is reset to Last 30 days', async () => {
    renderHome([
      makeCard({ noteId: 't', title: 'Today note', date: plusDays(0) }),
      makeCard({ noteId: 'o', title: 'Old note', date: plusDays(-200), lastModifiedAt: isoAtLocalNoon(-200) }),
    ])
    await selectRange('all')
    expect(await screen.findByText('Old note')).toBeInTheDocument()
    await userEvent.click(screen.getByTestId('range-preset-30'))
    await waitFor(() =>
      expect(screen.queryByText('Old note')).not.toBeInTheDocument(),
    )
    expect(screen.getByText('Today note')).toBeInTheDocument()
  })

  it('lists visible notes newest-first', () => {
    renderHome([
      makeCard({ noteId: 'b', title: 'Yesterday', date: plusDays(-1), lastModifiedAt: isoAtLocalNoon(-1) }),
      makeCard({ noteId: 'a', title: 'Today', date: plusDays(0) }),
      makeCard({ noteId: 'c', title: 'TwoDaysAgo', date: plusDays(-2), lastModifiedAt: isoAtLocalNoon(-2) }),
    ])
    expect(cardTitlesInOrder()).toEqual(['Today', 'Yesterday', 'TwoDaysAgo'])
  })

  it('hides future-dated notes in the default window but the All preset reveals them', async () => {
    renderHome([
      makeCard({ noteId: 'f', title: 'Future note', date: plusDays(7), lastModifiedAt: isoAtLocalNoon(0) }),
    ])
    expect(screen.queryByText('Future note')).not.toBeInTheDocument()
    await selectRange('all')
    expect(await screen.findByText('Future note')).toBeInTheDocument()
  })

  it('falls back to the createdAt calendar date when date is null', async () => {
    renderHome([
      makeCard({
        noteId: 'n',
        title: 'No explicit date',
        date: null,
        createdAt: isoAtLocalNoon(-200), // created long ago
        lastModifiedAt: isoAtLocalNoon(-200),
      }),
    ])
    // Long ago → hidden by the 30-day default…
    expect(screen.queryByText('No explicit date')).not.toBeInTheDocument()
    // …and revealed by All (which uses the same effective date).
    await selectRange('all')
    expect(await screen.findByText('No explicit date')).toBeInTheDocument()
  })

  it('shows an empty state with a Clear filters action when a range matches nothing', async () => {
    renderHome([
      makeCard({ noteId: 'o', title: 'Old note', date: plusDays(-200), lastModifiedAt: isoAtLocalNoon(-200) }),
    ])
    // Default 30-day window matches nothing here; no active filter yet ⇒ no Clear button.
    expect(screen.getByText('No notes here yet.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /clear filters/i })).not.toBeInTheDocument()
    // Pick "Today" — still empty, but now a non-default range is active ⇒ Clear appears.
    await selectRange('today')
    expect(await screen.findByText('No notes in this date range.')).toBeInTheDocument()
    const clear = screen.getByRole('button', { name: /clear filters/i })
    await userEvent.click(clear)
    // Clearing returns to the default window (still empty here, but back to default copy).
    await waitFor(() =>
      expect(screen.getByText('No notes here yet.')).toBeInTheDocument(),
    )
  })

  it('composes the date range with the tag filter', async () => {
    server.use(
      http.get('/api/tags', () =>
        HttpResponse.json({ tags: [{ tag: 'work', noteCount: 1, noteIds: ['w'] }] }),
      ),
    )
    renderHome([
      makeCard({ noteId: 'w', title: 'Work today', date: plusDays(0), tags: ['work'] }),
      makeCard({ noteId: 'x', title: 'Other today', date: plusDays(0), tags: [] }),
    ])
    await openFilters()
    const pill = await screen.findByTestId('tag-filter-pill-work')
    await userEvent.click(pill)
    expect(screen.getByText('Work today')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByText('Other today')).not.toBeInTheDocument())
  })

  it('matches a legacy mixed-case card tag via the lowercase filter pill (CHANGE-17)', async () => {
    server.use(
      http.get('/api/tags', () =>
        HttpResponse.json({ tags: [{ tag: 'work', noteCount: 1, noteIds: ['w'] }] }),
      ),
    )
    renderHome([
      makeCard({ noteId: 'w', title: 'Work today', date: plusDays(0), tags: ['Work'] }),
      makeCard({ noteId: 'x', title: 'Other today', date: plusDays(0), tags: [] }),
    ])
    await openFilters()
    const pill = await screen.findByTestId('tag-filter-pill-work')
    await userEvent.click(pill)
    expect(screen.getByText('Work today')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByText('Other today')).not.toBeInTheDocument())
  })

  it('does not date-filter or show the range control in folder view', () => {
    renderHome(
      [makeCard({ noteId: 'p', title: 'Past in folder', date: plusDays(-200), folderId: 'f-1', lastModifiedAt: isoAtLocalNoon(-200) })],
      { currentFolderId: 'f-1' },
    )
    expect(screen.getByText('Past in folder')).toBeInTheDocument()
    expect(screen.queryByTestId('range-preset-today')).not.toBeInTheDocument()
  })
})
