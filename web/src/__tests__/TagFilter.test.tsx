import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import type { NoteCard } from '../api/notes'
import ListView from '../components/ListView'
import TagFilter from '../components/TagFilter'
import { localTodayISO } from '../dates'
import { render, screen, waitFor } from '../test/render'
import { server } from '../test/setup'

describe('TagFilter — isolated', () => {
  it('renders a pill for each tag', () => {
    render(
      <TagFilter
        tags={['meeting', 'action']}
        selectedTags={[]}
        mode="AND"
        onToggle={() => {}}
        onModeChange={() => {}}
        onClear={() => {}}
      />,
    )
    expect(screen.getByTestId('tag-filter-pill-meeting')).toBeInTheDocument()
    expect(screen.getByTestId('tag-filter-pill-action')).toBeInTheDocument()
  })

  it('clicking a pill calls onToggle with the tag', async () => {
    const onToggle = vi.fn()
    render(
      <TagFilter
        tags={['meeting']}
        selectedTags={[]}
        mode="AND"
        onToggle={onToggle}
        onModeChange={() => {}}
        onClear={() => {}}
      />,
    )
    await userEvent.click(screen.getByTestId('tag-filter-pill-meeting'))
    expect(onToggle).toHaveBeenCalledWith('meeting')
  })

  it('clear button calls onClear when a tag is selected', async () => {
    const onClear = vi.fn()
    render(
      <TagFilter
        tags={['meeting']}
        selectedTags={['meeting']}
        mode="AND"
        onToggle={() => {}}
        onModeChange={() => {}}
        onClear={onClear}
      />,
    )
    await userEvent.click(screen.getByTestId('tag-filter-clear'))
    expect(onClear).toHaveBeenCalled()
  })

  it('mode toggle is visible with 2 selected tags and switches mode on click', async () => {
    const onModeChange = vi.fn()
    render(
      <TagFilter
        tags={['a', 'b']}
        selectedTags={['a', 'b']}
        mode="AND"
        onToggle={() => {}}
        onModeChange={onModeChange}
        onClear={() => {}}
      />,
    )
    const toggle = screen.getByTestId('tag-filter-mode-toggle')
    expect(toggle).toBeInTheDocument()
    await userEvent.click(toggle)
    expect(onModeChange).toHaveBeenCalledWith('OR')
  })

  it('returns nothing when tag list is empty', () => {
    const { container } = render(
      <TagFilter
        tags={[]}
        selectedTags={[]}
        mode="AND"
        onToggle={() => {}}
        onModeChange={() => {}}
        onClear={() => {}}
      />,
    )
    expect(container.firstChild).toBeNull()
  })
})

describe('TagFilter — tag-search box (CHANGE-18)', () => {
  const manyTags = [
    'work',
    'workshop',
    'home',
    'meeting',
    'action',
    'idea',
    'personal',
    'urgent',
    'review',
  ] // 9 tags → >8

  function renderWith(tags: string[], selectedTags: string[] = []) {
    return render(
      <TagFilter
        tags={tags}
        selectedTags={selectedTags}
        mode="AND"
        onToggle={() => {}}
        onModeChange={() => {}}
        onClear={() => {}}
      />,
    )
  }

  it('renders a search input when there are more than 8 tags', () => {
    renderWith(manyTags)
    expect(screen.getByTestId('tag-filter-search')).toBeInTheDocument()
  })

  it('does not render a search input with 8 or fewer tags', () => {
    renderWith(manyTags.slice(0, 8))
    expect(screen.queryByTestId('tag-filter-search')).not.toBeInTheDocument()
  })

  it('typing filters the displayed pills case-insensitively', async () => {
    renderWith(manyTags)
    await userEvent.type(screen.getByTestId('tag-filter-search'), 'wo')
    expect(screen.getByTestId('tag-filter-pill-work')).toBeInTheDocument()
    expect(screen.getByTestId('tag-filter-pill-workshop')).toBeInTheDocument()
    expect(screen.queryByTestId('tag-filter-pill-meeting')).not.toBeInTheDocument()
    expect(screen.queryByTestId('tag-filter-pill-home')).not.toBeInTheDocument()
  })

  it('clearing the search restores all pills', async () => {
    renderWith(manyTags)
    const input = screen.getByTestId('tag-filter-search')
    await userEvent.type(input, 'wo')
    expect(screen.queryByTestId('tag-filter-pill-meeting')).not.toBeInTheDocument()
    await userEvent.clear(input)
    expect(screen.getByTestId('tag-filter-pill-meeting')).toBeInTheDocument()
    expect(screen.getByTestId('tag-filter-pill-work')).toBeInTheDocument()
  })

  it('keeps a selected tag selected even when the search hides it', async () => {
    renderWith(manyTags, ['meeting'])
    // meeting is selected and visible…
    expect(screen.getByTestId('tag-filter-pill-meeting')).toHaveClass(/Active/)
    // …searching "wo" hides it, but Clear (acting on all selected tags) stays present
    await userEvent.type(screen.getByTestId('tag-filter-search'), 'wo')
    expect(screen.queryByTestId('tag-filter-pill-meeting')).not.toBeInTheDocument()
    expect(screen.getByTestId('tag-filter-clear')).toBeInTheDocument()
  })

  it('the search input has an accessible label', () => {
    renderWith(manyTags)
    expect(
      screen.getByRole('textbox', { name: /search tags/i }),
    ).toBeInTheDocument()
  })
})

describe('TagFilter — filtering cards via ListView', () => {
  // Dated today so both are visible in the home view by default; these tests
  // exercise tag filtering, not the today/older date filter.
  const today = localTodayISO()
  const alphaCard: NoteCard = {
    noteId: 'n-1', title: 'Alpha', contentPreview: '', date: today,
    openActions: [], createdAt: '2026-01-01T00:00:00Z', lastModifiedAt: '2026-01-01T00:00:00Z',
    tags: ['meeting'], folderId: null,
  }
  const betaCard: NoteCard = {
    noteId: 'n-2', title: 'Beta', contentPreview: '', date: today,
    openActions: [], createdAt: '2026-01-01T00:00:00Z', lastModifiedAt: '2026-01-01T00:00:00Z',
    tags: [], folderId: null,
  }

  beforeEach(() => {
    server.use(
      http.get('/api/tags', () =>
        HttpResponse.json({ tags: [{ tag: 'meeting', noteCount: 1, noteIds: ['n-1'] }] }),
      ),
    )
  })

  it('clicking a tag pill hides cards that do not match', async () => {
    render(
      <ListView
        cards={[alphaCard, betaCard]}
        loading={false}
        creating={false}
        createError={null}
        onNewNote={() => {}}
        onEditNote={() => {}}
        onOpenNote={() => {}}
      />,
    )
    // Home filters default to collapsed (CHANGE-6) — expand first.
    await userEvent.click(screen.getByRole('button', { name: /^filters/i }))
    const pill = await screen.findByTestId('tag-filter-pill-meeting')
    await userEvent.click(pill)
    expect(screen.getByText('Alpha')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByText('Beta')).not.toBeInTheDocument())
  })

  it('clear button restores all cards after filtering', async () => {
    render(
      <ListView
        cards={[alphaCard, betaCard]}
        loading={false}
        creating={false}
        createError={null}
        onNewNote={() => {}}
        onEditNote={() => {}}
        onOpenNote={() => {}}
      />,
    )
    // Home filters default to collapsed (CHANGE-6) — expand first.
    await userEvent.click(screen.getByRole('button', { name: /^filters/i }))
    const pill = await screen.findByTestId('tag-filter-pill-meeting')
    await userEvent.click(pill)
    await waitFor(() => expect(screen.queryByText('Beta')).not.toBeInTheDocument())
    await userEvent.click(screen.getByTestId('tag-filter-clear'))
    expect(await screen.findByText('Beta')).toBeInTheDocument()
    expect(screen.getByText('Alpha')).toBeInTheDocument()
  })
})
