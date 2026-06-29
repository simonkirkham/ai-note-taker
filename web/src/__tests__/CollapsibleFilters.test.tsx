import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import type { NoteCard } from '../api/notes'
import ListView from '../components/ListView'
import { localDateISO } from '../dates'
import { renderWithRouter as render, screen, waitFor } from '../test/render'
import { server } from '../test/setup'

// Dates relative to the real "today" so these never become a time-bomb.
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

function renderView(cards: NoteCard[], extra: Record<string, unknown> = {}) {
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

function filtersToggle() {
  return screen.getByRole('button', { name: /^filters/i })
}

function useWorkTag() {
  server.use(
    http.get('/api/tags', () =>
      HttpResponse.json({ tags: [{ tag: 'work', noteCount: 1, noteIds: ['w'] }] }),
    ),
  )
}

describe('CHANGE-6 — collapsible Filters on the home view', () => {
  it('defaults to collapsed: a Filters control is shown but the tag controls are not', async () => {
    useWorkTag()
    renderView([makeCard({ noteId: 'a', title: 'Today note', tags: ['work'] })])
    // The toggle exists and is collapsed.
    const toggle = filtersToggle()
    expect(toggle).toBeInTheDocument()
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    // The tag controls are not rendered while collapsed — wait a tick so the
    // tag fetch has resolved and would have rendered the pill if not gated.
    await waitFor(() =>
      expect(screen.queryByTestId('tag-filter')).not.toBeInTheDocument(),
    )
    expect(screen.queryByTestId('tag-filter-pill-work')).not.toBeInTheDocument()
  })

  it('expanding Filters reveals the tag pills, mode toggle, and Clear', async () => {
    server.use(
      http.get('/api/tags', () =>
        HttpResponse.json({
          tags: [
            { tag: 'work', noteCount: 1, noteIds: ['w'] },
            { tag: 'home', noteCount: 1, noteIds: ['h'] },
          ],
        }),
      ),
    )
    renderView([
      makeCard({ noteId: 'w', title: 'Work', tags: ['work', 'home'] }),
    ])
    await userEvent.click(filtersToggle())
    expect(filtersToggle()).toHaveAttribute('aria-expanded', 'true')
    expect(await screen.findByTestId('tag-filter-pill-work')).toBeInTheDocument()
    expect(screen.getByTestId('tag-filter-pill-home')).toBeInTheDocument()
    // Select two tags so the AND/OR mode toggle and Clear appear.
    await userEvent.click(screen.getByTestId('tag-filter-pill-work'))
    await userEvent.click(screen.getByTestId('tag-filter-pill-home'))
    expect(screen.getByTestId('tag-filter-mode-toggle')).toBeInTheDocument()
    expect(screen.getByTestId('tag-filter-clear')).toBeInTheDocument()
  })

  it('the toggle controls the panel via aria-controls / matching id', async () => {
    useWorkTag()
    renderView([makeCard({ noteId: 'a', title: 'Today note', tags: ['work'] })])
    const toggle = filtersToggle()
    const panelId = toggle.getAttribute('aria-controls')
    expect(panelId).toBeTruthy()
    await userEvent.click(toggle)
    const panel = document.getElementById(panelId as string)
    expect(panel).not.toBeNull()
    expect(panel).toContainElement(await screen.findByTestId('tag-filter-pill-work'))
  })

  it('collapsing Filters hides the controls again', async () => {
    useWorkTag()
    renderView([makeCard({ noteId: 'a', title: 'Today note', tags: ['work'] })])
    await userEvent.click(filtersToggle())
    expect(await screen.findByTestId('tag-filter-pill-work')).toBeInTheDocument()
    await userEvent.click(filtersToggle())
    await waitFor(() =>
      expect(screen.queryByTestId('tag-filter-pill-work')).not.toBeInTheDocument(),
    )
    expect(filtersToggle()).toHaveAttribute('aria-expanded', 'false')
  })

  it('summarises active filters on the collapsed control (Option D)', async () => {
    useWorkTag()
    renderView([makeCard({ noteId: 'w', title: 'Work today', tags: ['work'] })])
    // Expand, select the tag, then collapse.
    await userEvent.click(filtersToggle())
    await userEvent.click(await screen.findByTestId('tag-filter-pill-work'))
    await userEvent.click(filtersToggle())
    // Collapsed control now summarises the active filter (Option D).
    const toggle = filtersToggle()
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(toggle).toHaveTextContent(/filters · 1 tag/i)
    // And the list stays filtered to the selected tag even while collapsed.
    expect(screen.getByText('Work today')).toBeInTheDocument()
  })

  it('show older notes lives inside the expanded panel, not the Notes header', async () => {
    useWorkTag()
    renderView([makeCard({ noteId: 'a', title: 'Today note', tags: ['work'] })])
    // Collapsed: the toggle is not rendered yet.
    expect(
      screen.queryByRole('checkbox', { name: /show older notes/i }),
    ).not.toBeInTheDocument()
    // Expand: it appears inside the Filters panel.
    await userEvent.click(filtersToggle())
    const older = await screen.findByRole('checkbox', { name: /show older notes/i })
    expect(document.getElementById('home-filters-panel')).toContainElement(older)
  })

  it('collapsed summary reflects "show older" too (Option D)', async () => {
    useWorkTag()
    renderView([makeCard({ noteId: 'a', title: 'Today note', tags: ['work'] })])
    await userEvent.click(filtersToggle())
    await userEvent.click(
      await screen.findByRole('checkbox', { name: /show older notes/i }),
    )
    await userEvent.click(filtersToggle()) // collapse
    expect(filtersToggle()).toHaveTextContent(/filters · older/i)
  })

  it('does not show a count when collapsed with no tags selected', () => {
    useWorkTag()
    renderView([makeCard({ noteId: 'a', title: 'Today note', tags: ['work'] })])
    const toggle = filtersToggle()
    // Accessible name excludes the aria-hidden chevron — just "Filters", no count.
    expect(toggle).toHaveAccessibleName(/^filters$/i)
    expect(toggle).not.toHaveAccessibleName(/\(/)
  })

  it('filtering still composes with the CHANGE-3 today/older date filter', async () => {
    server.use(
      http.get('/api/tags', () =>
        HttpResponse.json({ tags: [{ tag: 'work', noteCount: 2, noteIds: ['w1', 'w2'] }] }),
      ),
    )
    renderView([
      makeCard({ noteId: 'w1', title: 'Work today', date: plusDays(0), tags: ['work'] }),
      makeCard({
        noteId: 'w2',
        title: 'Work last week',
        date: plusDays(-7),
        lastModifiedAt: isoAtLocalNoon(-7),
        tags: ['work'],
      }),
      makeCard({ noteId: 'x', title: 'Other today', date: plusDays(0), tags: [] }),
    ])
    // Expand filters and select "work".
    await userEvent.click(filtersToggle())
    await userEvent.click(await screen.findByTestId('tag-filter-pill-work'))
    // CHANGE-19: selecting the first tag auto-enables "show older", so both work
    // notes are revealed; the untagged note is filtered out by the tag.
    expect(screen.getByText('Work today')).toBeInTheDocument()
    expect(await screen.findByText('Work last week')).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.queryByText('Other today')).not.toBeInTheDocument(),
    )
    // Manually unticking "Show older" re-applies the date filter on top of the
    // tag filter: the past-dated work note hides, today's stays.
    await userEvent.click(screen.getByRole('checkbox', { name: /show older notes/i }))
    await waitFor(() =>
      expect(screen.queryByText('Work last week')).not.toBeInTheDocument(),
    )
    expect(screen.getByText('Work today')).toBeInTheDocument()
    expect(screen.queryByText('Other today')).not.toBeInTheDocument()
  })

  it('does not render the collapsible Filters control in folder view', () => {
    useWorkTag()
    renderView(
      [
        makeCard({
          noteId: 'p',
          title: 'Past in folder',
          date: plusDays(-30),
          folderId: 'f-1',
          lastModifiedAt: isoAtLocalNoon(-30),
          tags: ['work'],
        }),
      ],
      { currentFolderId: 'f-1' },
    )
    // Folder view keeps the old, always-visible TagFilter — no Filters toggle.
    expect(screen.queryByRole('button', { name: /^filters/i })).not.toBeInTheDocument()
    expect(screen.getByText('Past in folder')).toBeInTheDocument()
  })

  it('folder view still renders the tag filter directly (unaffected)', async () => {
    useWorkTag()
    renderView(
      [
        makeCard({
          noteId: 'p',
          title: 'Folder note',
          folderId: 'f-1',
          tags: ['work'],
        }),
      ],
      { currentFolderId: 'f-1' },
    )
    // The tag pill is visible without any expand step in folder view.
    expect(await screen.findByTestId('tag-filter-pill-work')).toBeInTheDocument()
  })
})
