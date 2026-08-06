import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import type { TagIndexEntry } from '../api/tags'
import CommandBar from '../components/CommandBar'
import { render, screen, waitFor } from '../test/render'
import { server } from '../test/setup'

const NOTE_ID = 'note-1'

const open1 = { actionId: 'a-1', description: 'Book meeting', completed: false, addedAt: '2026-01-01T00:00:00Z', completedAt: null }
const done1 = { actionId: 'a-2', description: 'Send notes', completed: true, addedAt: '2026-01-01T00:00:00Z', completedAt: '2026-01-02T00:00:00Z' }

function seedActions(actions: object[]) {
  server.use(
    http.get(`/api/notes/${NOTE_ID}/actions`, () => HttpResponse.json({ actions })),
  )
}

function mkTag(tag: string, noteCount = 1): TagIndexEntry {
  return { tag, noteCount, noteIds: [] }
}

function renderBar(props: {
  tags?: string[]
  allTags?: TagIndexEntry[]
  onAddTags?: (raw: string) => void
  onRemoveTag?: (tag: string) => void
} = {}) {
  const onAddTags = props.onAddTags ?? vi.fn()
  const onRemoveTag = props.onRemoveTag ?? vi.fn()
  render(
    <CommandBar
      noteId={NOTE_ID}
      tags={props.tags ?? []}
      allTags={props.allTags ?? []}
      onAddTags={onAddTags}
      onRemoveTag={onRemoveTag}
    />,
  )
  return { onAddTags, onRemoveTag }
}

describe('CommandBar — tags', () => {
  it('renders applied tags as chips', () => {
    renderBar({ tags: ['work', 'planning'] })
    expect(screen.getByTestId('tag-pill-work')).toBeInTheDocument()
    expect(screen.getByTestId('tag-pill-planning')).toBeInTheDocument()
  })

  it('clicking a chip × calls onRemoveTag (optimistic handler fires immediately)', async () => {
    const onRemoveTag = vi.fn()
    renderBar({ tags: ['work'], onRemoveTag })
    await userEvent.click(screen.getByLabelText('Remove tag work'))
    expect(onRemoveTag).toHaveBeenCalledWith('work')
  })

  it('the combobox is hidden until ＋ Tag is clicked', () => {
    renderBar()
    expect(screen.queryByTestId('tag-input')).toBeNull()
    expect(screen.getByTestId('add-tag-button')).toBeInTheDocument()
  })

  it('clicking ＋ Tag reveals the combobox; typing + Enter calls onAddTags', async () => {
    const onAddTags = vi.fn()
    renderBar({ onAddTags })
    await userEvent.click(screen.getByTestId('add-tag-button'))
    const input = await screen.findByTestId('tag-input')
    await userEvent.type(input, 'roadmap{Enter}')
    expect(onAddTags).toHaveBeenCalledWith('roadmap')
  })

  it('the combobox suggests existing tags', async () => {
    renderBar({ allTags: [mkTag('roadmap', 5), mkTag('retro', 2)] })
    await userEvent.click(screen.getByTestId('add-tag-button'))
    const input = await screen.findByTestId('tag-input')
    await userEvent.type(input, 'r')
    expect(await screen.findByTestId('suggestion-roadmap')).toBeInTheDocument()
  })
})

describe('CommandBar — actions pill', () => {
  it('shows done/total without opening the popover', async () => {
    seedActions([open1, done1])
    renderBar()
    await waitFor(() => expect(screen.getByTestId('actions-count')).toHaveTextContent('1/2'))
    expect(screen.queryByTestId('actions-popover')).toBeNull()
  })

  it('shows 0/0 when there are no actions and the pill is still visible', async () => {
    seedActions([])
    renderBar()
    await waitFor(() => expect(screen.getByTestId('actions-count')).toHaveTextContent('0/0'))
    expect(screen.getByTestId('actions-pill')).toBeInTheDocument()
  })

  it('clicking the pill opens the popover anchored to it', async () => {
    seedActions([open1])
    renderBar()
    await waitFor(() => expect(screen.getByTestId('actions-count')).toHaveTextContent('0/1'))
    await userEvent.click(screen.getByTestId('actions-pill'))
    expect(await screen.findByTestId('actions-popover')).toBeInTheDocument()
    expect(screen.getByTestId('actions-pill')).toHaveAttribute('aria-expanded', 'true')
  })

  it('clicking outside closes the popover', async () => {
    seedActions([open1])
    renderBar()
    await waitFor(() => expect(screen.getByTestId('actions-count')).toHaveTextContent('0/1'))
    await userEvent.click(screen.getByTestId('actions-pill'))
    expect(await screen.findByTestId('actions-popover')).toBeInTheDocument()
    await userEvent.click(document.body)
    await waitFor(() => expect(screen.queryByTestId('actions-popover')).toBeNull())
  })

  it('pressing Esc closes the popover', async () => {
    seedActions([open1])
    renderBar()
    await waitFor(() => expect(screen.getByTestId('actions-count')).toHaveTextContent('0/1'))
    await userEvent.click(screen.getByTestId('actions-pill'))
    expect(await screen.findByTestId('actions-popover')).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByTestId('actions-popover')).toBeNull())
  })

  it('clicking a checkbox inside keeps the popover open (optimistic toggle)', async () => {
    seedActions([open1])
    server.use(
      http.post(`/api/notes/${NOTE_ID}/actions/:actionId/complete`, () => new HttpResponse(null, { status: 200 })),
    )
    renderBar()
    await waitFor(() => expect(screen.getByTestId('actions-count')).toHaveTextContent('0/1'))
    await userEvent.click(screen.getByTestId('actions-pill'))
    const checkbox = await screen.findByRole('checkbox', { name: /Book meeting/i })
    await userEvent.click(checkbox)
    // Optimistic: checkbox flips immediately and the popover stays open.
    await waitFor(() => expect(checkbox).toBeChecked())
    expect(screen.getByTestId('actions-popover')).toBeInTheDocument()
  })
})

describe('CommandBar — all-done teal state', () => {
  it('does not mark the pill done while an item is open', async () => {
    seedActions([open1, done1])
    renderBar()
    await waitFor(() => expect(screen.getByTestId('actions-count')).toHaveTextContent('1/2'))
    const pill = screen.getByTestId('actions-pill')
    expect(pill.className).not.toMatch(/Done/)
  })

  it('marks the pill done (teal) when every action is complete', async () => {
    seedActions([done1])
    renderBar()
    await waitFor(() => expect(screen.getByTestId('actions-count')).toHaveTextContent('1/1'))
    const pill = screen.getByTestId('actions-pill')
    expect(pill.className).toMatch(/Done/)
  })
})
