import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '../test/setup'
import ListView from '../components/ListView'
import type { NoteCard } from '../api'
import { localDateISO } from '../dates'

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

// CHANGE-9 (Option D): "Show older notes" now lives inside the collapsed
// Filters panel, so expand it first before reaching the checkbox.
async function olderToggle() {
  const btn = screen.getByRole('button', { name: /^filters/i })
  if (btn.getAttribute('aria-expanded') !== 'true') {
    await userEvent.click(btn)
  }
  return screen.getByRole('checkbox', { name: /show older notes/i })
}

function cardTitlesInOrder(): string[] {
  const container = screen.getByTestId('note-cards')
  return within(container)
    .getAllByRole('heading', { level: 3 })
    .map((h) => h.textContent ?? '')
}

describe('ListView — home today/older date filter', () => {
  it('shows today’s notes by default and hides last week’s', () => {
    renderHome([
      makeCard({ noteId: 't', title: 'Today note', date: plusDays(0) }),
      makeCard({
        noteId: 'o',
        title: 'Old note',
        date: plusDays(-7),
        lastModifiedAt: isoAtLocalNoon(-7),
      }),
    ])
    expect(screen.getByText('Today note')).toBeInTheDocument()
    expect(screen.queryByText('Old note')).not.toBeInTheDocument()
  })

  it('shows a note edited today even if it is dated earlier', () => {
    renderHome([
      makeCard({
        noteId: 'e',
        title: 'Edited today',
        date: plusDays(-7),
        lastModifiedAt: isoAtLocalNoon(0),
      }),
    ])
    expect(screen.getByText('Edited today')).toBeInTheDocument()
  })

  it('hides a note dated and edited before today by default', () => {
    renderHome([
      makeCard({
        noteId: 'p',
        title: 'Stale note',
        date: plusDays(-7),
        lastModifiedAt: isoAtLocalNoon(-7),
      }),
    ])
    expect(screen.queryByText('Stale note')).not.toBeInTheDocument()
  })

  it('hides future-dated notes in both toggle states', async () => {
    renderHome([
      makeCard({
        noteId: 'f',
        title: 'Future note',
        date: plusDays(7),
        lastModifiedAt: isoAtLocalNoon(0), // even though edited today
      }),
    ])
    expect(screen.queryByText('Future note')).not.toBeInTheDocument()
    await userEvent.click(await olderToggle())
    expect(screen.queryByText('Future note')).not.toBeInTheDocument()
  })

  it('lists visible notes newest-first', async () => {
    renderHome([
      makeCard({ noteId: 'b', title: 'Yesterday', date: plusDays(-1), lastModifiedAt: isoAtLocalNoon(-1) }),
      makeCard({ noteId: 'a', title: 'Today', date: plusDays(0) }),
      makeCard({ noteId: 'c', title: 'TwoDaysAgo', date: plusDays(-2), lastModifiedAt: isoAtLocalNoon(-2) }),
    ])
    await userEvent.click(await olderToggle())
    expect(cardTitlesInOrder()).toEqual(['Today', 'Yesterday', 'TwoDaysAgo'])
  })

  it('toggling Show older notes reveals then hides past notes', async () => {
    renderHome([
      makeCard({ noteId: 't', title: 'Today note', date: plusDays(0) }),
      makeCard({ noteId: 'o', title: 'Old note', date: plusDays(-7), lastModifiedAt: isoAtLocalNoon(-7) }),
    ])
    expect(screen.queryByText('Old note')).not.toBeInTheDocument()
    await userEvent.click(await olderToggle())
    expect(screen.getByText('Old note')).toBeInTheDocument()
    await userEvent.click(await olderToggle())
    expect(screen.queryByText('Old note')).not.toBeInTheDocument()
  })

  it('falls back to the createdAt calendar date when date is null', async () => {
    renderHome([
      makeCard({
        noteId: 'n',
        title: 'No explicit date',
        date: null,
        createdAt: isoAtLocalNoon(-1), // created yesterday
        lastModifiedAt: isoAtLocalNoon(-1),
      }),
    ])
    // Yesterday → hidden by default…
    expect(screen.queryByText('No explicit date')).not.toBeInTheDocument()
    // …and revealed as a past note when older is shown.
    await userEvent.click(await olderToggle())
    expect(screen.getByText('No explicit date')).toBeInTheDocument()
  })

  it('keeps the Filters control available and shows empty copy when nothing matches today', async () => {
    renderHome([
      makeCard({ noteId: 'o', title: 'Old note', date: plusDays(-5), lastModifiedAt: isoAtLocalNoon(-5) }),
    ])
    expect(screen.getByText('No notes today')).toBeInTheDocument()
    // The Filters control is always available; expanding it reveals "Show older".
    expect(screen.getByRole('button', { name: /^filters/i })).toBeInTheDocument()
    await userEvent.click(await olderToggle())
    expect(screen.getByText('Old note')).toBeInTheDocument()
  })

  it('composes the date filter with the tag filter', async () => {
    server.use(
      http.get('/api/tags', () =>
        HttpResponse.json({ tags: [{ tag: 'work', noteCount: 1, noteIds: ['w'] }] }),
      ),
    )
    renderHome([
      makeCard({ noteId: 'w', title: 'Work today', date: plusDays(0), tags: ['work'] }),
      makeCard({ noteId: 'x', title: 'Other today', date: plusDays(0), tags: [] }),
    ])
    // Home filters default to collapsed (CHANGE-6) — expand first.
    await userEvent.click(screen.getByRole('button', { name: /^filters/i }))
    const pill = await screen.findByTestId('tag-filter-pill-work')
    await userEvent.click(pill)
    expect(screen.getByText('Work today')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByText('Other today')).not.toBeInTheDocument())
  })

  it('does not date-filter or show the toggle in folder view', () => {
    renderHome(
      [makeCard({ noteId: 'p', title: 'Past in folder', date: plusDays(-30), folderId: 'f-1', lastModifiedAt: isoAtLocalNoon(-30) })],
      { currentFolderId: 'f-1' },
    )
    expect(screen.getByText('Past in folder')).toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: /show older notes/i })).not.toBeInTheDocument()
  })
})
