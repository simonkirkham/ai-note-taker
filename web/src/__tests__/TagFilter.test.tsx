import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '../test/setup'
import ListView from '../components/ListView'
import TagFilter from '../components/TagFilter'
import type { NoteCard } from '../api'

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

describe('TagFilter — filtering cards via ListView', () => {
  const alphaCard: NoteCard = {
    noteId: 'n-1', title: 'Alpha', contentPreview: '', date: null,
    openActions: [], createdAt: '2026-01-01T00:00:00Z', tags: ['meeting'], folderId: null,
  }
  const betaCard: NoteCard = {
    noteId: 'n-2', title: 'Beta', contentPreview: '', date: null,
    openActions: [], createdAt: '2026-01-01T00:00:00Z', tags: [], folderId: null,
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
      />,
    )
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
      />,
    )
    const pill = await screen.findByTestId('tag-filter-pill-meeting')
    await userEvent.click(pill)
    await waitFor(() => expect(screen.queryByText('Beta')).not.toBeInTheDocument())
    await userEvent.click(screen.getByTestId('tag-filter-clear'))
    expect(await screen.findByText('Beta')).toBeInTheDocument()
    expect(screen.getByText('Alpha')).toBeInTheDocument()
  })
})
