import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { TagIndexEntry } from '../api/tags'
import TagsSection from '../components/TagsSection'

function mkTag(tag: string, noteCount: number, noteIds: string[] = []): TagIndexEntry {
  return { tag, noteCount, noteIds }
}

function renderTags(props: {
  tags?: string[]
  allTags?: TagIndexEntry[]
  onAdd?: (t: string) => void
  onRemove?: (t: string) => void
} = {}) {
  const onAdd = props.onAdd ?? vi.fn()
  const onRemove = props.onRemove ?? vi.fn()
  render(
    <TagsSection
      tags={props.tags ?? []}
      allTags={props.allTags ?? []}
      onAdd={onAdd}
      onRemove={onRemove}
    />,
  )
  const input = screen.getByTestId('tag-input')
  return { input, onAdd, onRemove }
}

describe('TagsSection — existing behavior', () => {
  it('displays applied tag pills', () => {
    renderTags({ tags: ['Work', 'Personal'] })
    expect(screen.getByTestId('tag-pill-Work')).toBeInTheDocument()
    expect(screen.getByTestId('tag-pill-Personal')).toBeInTheDocument()
  })

  it('remove button calls onRemove with the correct tag', async () => {
    const onRemove = vi.fn()
    renderTags({ tags: ['Work', 'Personal'], onRemove })
    await userEvent.click(screen.getByLabelText('Remove tag Work'))
    expect(onRemove).toHaveBeenCalledWith('Work')
    expect(onRemove).toHaveBeenCalledTimes(1)
  })

  it('blurring the input submits the typed text (lowercased)', async () => {
    const user = userEvent.setup()
    const onAdd = vi.fn()
    const { input } = renderTags({ onAdd })
    await user.type(input, 'NewTag')
    await user.tab()
    expect(onAdd).toHaveBeenCalledWith('newtag')
  })

  it('blurring an empty input does not submit', () => {
    const onAdd = vi.fn()
    const { input } = renderTags({ onAdd })
    fireEvent.blur(input)
    expect(onAdd).not.toHaveBeenCalled()
  })
})

describe('TagsSection — case-insensitive add (CHANGE-17)', () => {
  it('lowercases a mixed-case tag before calling onAdd', async () => {
    const user = userEvent.setup()
    const onAdd = vi.fn()
    const { input } = renderTags({ onAdd })
    await user.type(input, 'Foo Bar{Enter}')
    expect(onAdd).toHaveBeenCalledWith('foo bar')
  })

  it('trims and lowercases on submit', async () => {
    const user = userEvent.setup()
    const onAdd = vi.fn()
    const { input } = renderTags({ onAdd })
    await user.type(input, '  Work ')
    await user.tab()
    expect(onAdd).toHaveBeenCalledWith('work')
  })
})

describe('TagsSection — typing suggestions', () => {
  it('prefix matches appear before substring matches', async () => {
    const allTags = [
      mkTag('Hunting', 3),
      mkTag('JobHunting', 5),
    ]
    const { input } = renderTags({ allTags })
    await userEvent.type(input, 'hunt')
    const items = screen.getAllByRole('option')
    expect(items[0]).toHaveTextContent('Hunting')
    expect(items[1]).toHaveTextContent('JobHunting')
  })

  it('prefix matches are sorted by noteCount descending', async () => {
    const allTags = [
      mkTag('apex', 5),
      mkTag('apricot', 1),
      mkTag('ape', 3),
    ]
    const { input } = renderTags({ allTags })
    await userEvent.type(input, 'ap')
    const items = screen.getAllByRole('option')
    expect(items[0]).toHaveTextContent('apex')
    expect(items[1]).toHaveTextContent('ape')
    expect(items[2]).toHaveTextContent('apricot')
  })

  it('already-applied tags are excluded from typing suggestions', async () => {
    const allTags = [mkTag('Work', 5), mkTag('Weekend', 3)]
    const { input } = renderTags({ tags: ['Work'], allTags })
    await userEvent.type(input, 'w')
    expect(screen.queryByTestId('suggestion-Work')).toBeNull()
    expect(screen.getByTestId('suggestion-Weekend')).toBeInTheDocument()
  })

  it('shows no dropdown when no tags match', async () => {
    const allTags = [mkTag('Python', 3)]
    const { input } = renderTags({ allTags })
    await userEvent.type(input, 'xyz')
    expect(screen.queryByTestId('tag-suggestions')).toBeNull()
  })
})

describe('TagsSection — empty focus state', () => {
  it('shows Common heading with top tags by noteCount on empty focus', async () => {
    const allTags = [
      mkTag('Work', 5),
      mkTag('Personal', 3),
      mkTag('Meeting', 1),
    ]
    const { input } = renderTags({ allTags })
    await userEvent.click(input)
    expect(screen.getByTestId('heading-Common')).toBeInTheDocument()
    const items = screen.getAllByRole('option')
    expect(items[0]).toHaveTextContent('Work')
    expect(items[1]).toHaveTextContent('Personal')
    expect(items[2]).toHaveTextContent('Meeting')
  })

  it('shows Related heading with co-occurring tags when note has applied tags', async () => {
    // Design and Sprint have low noteCount so they don't make the Common top-8,
    // which prevents them appearing in both Related and Common sections.
    const allTags = [
      mkTag('Project-Alpha', 3, ['n1', 'n2', 'n3']),
      mkTag('Design', 2, ['n1', 'n2']),
      mkTag('Sprint', 1, ['n1']),
      mkTag('C1', 10, ['n99']), mkTag('C2', 9, ['n98']), mkTag('C3', 8, ['n97']),
      mkTag('C4', 7, ['n96']), mkTag('C5', 6, ['n95']), mkTag('C6', 5, ['n94']),
      mkTag('C7', 4, ['n93']), mkTag('C8', 3, ['n92']),
    ]
    const { input } = renderTags({ tags: ['Project-Alpha'], allTags })
    await userEvent.click(input)
    expect(screen.getByTestId('heading-Related')).toBeInTheDocument()
    expect(screen.getByTestId('suggestion-Design')).toBeInTheDocument()
    expect(screen.getByTestId('suggestion-Sprint')).toBeInTheDocument()
  })

  it('Related appears above Common', async () => {
    // CoTag has low noteCount (1) so it doesn't appear in the Common top-8,
    // preventing duplicate testids and ensuring clear section ordering.
    const allTags = [
      mkTag('Applied', 3, ['n1', 'n2', 'n3']),
      mkTag('CoTag', 1, ['n1']),
      mkTag('C1', 10, ['n99']), mkTag('C2', 9, ['n98']), mkTag('C3', 8, ['n97']),
      mkTag('C4', 7, ['n96']), mkTag('C5', 6, ['n95']), mkTag('C6', 5, ['n94']),
      mkTag('C7', 4, ['n93']), mkTag('C8', 3, ['n92']),
    ]
    const { input } = renderTags({ tags: ['Applied'], allTags })
    await userEvent.click(input)
    const relatedHeading = screen.getByTestId('heading-Related')
    const commonHeading = screen.getByTestId('heading-Common')
    expect(
      relatedHeading.compareDocumentPosition(commonHeading) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it('does not show Related section when note has no applied tags', async () => {
    const allTags = [mkTag('Work', 5, ['n1']), mkTag('Design', 3, ['n1'])]
    const { input } = renderTags({ allTags })
    await userEvent.click(input)
    expect(screen.queryByTestId('heading-Related')).toBeNull()
    expect(screen.getByTestId('heading-Common')).toBeInTheDocument()
  })

  it('excludes already-applied tags from empty-focus suggestions', async () => {
    const allTags = [mkTag('Work', 5), mkTag('Personal', 3)]
    const { input } = renderTags({ tags: ['Work'], allTags })
    await userEvent.click(input)
    expect(screen.queryByTestId('suggestion-Work')).toBeNull()
    expect(screen.getByTestId('suggestion-Personal')).toBeInTheDocument()
  })

  it('shows no dropdown when there are no available tags', async () => {
    const { input } = renderTags({ tags: ['Work'], allTags: [mkTag('Work', 5)] })
    await userEvent.click(input)
    expect(screen.queryByTestId('tag-suggestions')).toBeNull()
  })

  it('a tag that qualifies for both Related and Common appears exactly once', async () => {
    // HighOverlap has high noteCount (10) AND overlaps Applied's noteIds
    const allTags = [
      mkTag('Applied', 3, ['n1', 'n2', 'n3']),
      mkTag('HighOverlap', 10, ['n1', 'n2', 'n3']),
      mkTag('Other', 5, ['n99']),
    ]
    const { input } = renderTags({ tags: ['Applied'], allTags })
    await userEvent.click(input)
    expect(screen.getAllByTestId('suggestion-HighOverlap')).toHaveLength(1)
  })
})

describe('TagsSection — keyboard navigation', () => {
  it('ArrowDown highlights the first suggestion', async () => {
    const allTags = [mkTag('Work', 5), mkTag('Personal', 3)]
    const { input } = renderTags({ allTags })
    await userEvent.click(input)
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    const options = screen.getAllByRole('option')
    expect(options[0]).toHaveAttribute('aria-selected', 'true')
    expect(options[1]).toHaveAttribute('aria-selected', 'false')
  })

  it('ArrowDown twice highlights the second suggestion', async () => {
    const allTags = [mkTag('Work', 5), mkTag('Personal', 3), mkTag('Meeting', 1)]
    const { input } = renderTags({ allTags })
    await userEvent.click(input)
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    const options = screen.getAllByRole('option')
    expect(options[0]).toHaveAttribute('aria-selected', 'false')
    expect(options[1]).toHaveAttribute('aria-selected', 'true')
  })

  it('ArrowUp after one ArrowDown removes the highlight', async () => {
    const allTags = [mkTag('Work', 5), mkTag('Personal', 3)]
    const { input } = renderTags({ allTags })
    await userEvent.click(input)
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'ArrowUp' })
    screen.getAllByRole('option').forEach((opt) => {
      expect(opt).toHaveAttribute('aria-selected', 'false')
    })
  })

  it('Enter on a highlighted suggestion submits that tag', async () => {
    const onAdd = vi.fn()
    const allTags = [mkTag('Work', 5), mkTag('Personal', 3)]
    const { input } = renderTags({ allTags, onAdd })
    await userEvent.click(input)
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onAdd).toHaveBeenCalledWith('work')
  })

  it('Enter with no highlight submits the raw input text', async () => {
    const user = userEvent.setup()
    const onAdd = vi.fn()
    const { input } = renderTags({ onAdd })
    await user.type(input, 'MyTag')
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onAdd).toHaveBeenCalledWith('mytag')
  })

  it('Enter with dropdown open and no highlight submits the raw input', async () => {
    const onAdd = vi.fn()
    const allTags = [mkTag('Work', 5), mkTag('Weekend', 3)]
    const { input } = renderTags({ allTags, onAdd })
    await userEvent.click(input)
    expect(screen.getByTestId('tag-suggestions')).toBeInTheDocument()
    // highlightedIndex is -1 (nothing highlighted)
    await userEvent.type(input, 'my-custom')
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onAdd).toHaveBeenCalledWith('my-custom')
  })

  it('Escape closes the dropdown without submitting or clearing input', async () => {
    const onAdd = vi.fn()
    const allTags = [mkTag('Work', 5)]
    const { input } = renderTags({ allTags, onAdd })
    await userEvent.click(input)
    expect(screen.getByTestId('tag-suggestions')).toBeInTheDocument()
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(screen.queryByTestId('tag-suggestions')).toBeNull()
    expect(onAdd).not.toHaveBeenCalled()
  })

  it('Tab on an open dropdown fills the input with the first suggestion and closes the dropdown', async () => {
    const onAdd = vi.fn()
    const allTags = [mkTag('JobHunting', 5), mkTag('JavaScript', 2)]
    const { input } = renderTags({ allTags, onAdd })
    await userEvent.click(input)
    expect(screen.getByTestId('tag-suggestions')).toBeInTheDocument()
    fireEvent.keyDown(input, { key: 'Tab' })
    await waitFor(() => expect(input).toHaveValue('JobHunting'))
    expect(screen.queryByTestId('tag-suggestions')).toBeNull()
    expect(onAdd).not.toHaveBeenCalled()
  })

  it('Tab on an open dropdown with a highlighted item fills that item', async () => {
    const onAdd = vi.fn()
    const allTags = [mkTag('Alpha', 5), mkTag('Beta', 3)]
    const { input } = renderTags({ allTags, onAdd })
    await userEvent.click(input)
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'Tab' })
    await waitFor(() => expect(input).toHaveValue('Beta'))
    expect(onAdd).not.toHaveBeenCalled()
  })

  it('ArrowRight on a highlighted suggestion fills the input', async () => {
    const onAdd = vi.fn()
    const allTags = [mkTag('Work', 5), mkTag('Weekend', 3)]
    const { input } = renderTags({ allTags, onAdd })
    await userEvent.click(input)
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'ArrowRight' })
    expect(input).toHaveValue('Work')
    expect(screen.queryByTestId('tag-suggestions')).toBeNull()
    expect(onAdd).not.toHaveBeenCalled()
  })
})

describe('TagsSection — mouse interaction', () => {
  it('clicking a suggestion submits it immediately', async () => {
    const onAdd = vi.fn()
    const allTags = [mkTag('Design', 3)]
    const { input } = renderTags({ allTags, onAdd })
    await userEvent.click(input)
    const suggestion = screen.getByTestId('suggestion-Design')
    fireEvent.mouseDown(suggestion)
    fireEvent.click(suggestion)
    expect(onAdd).toHaveBeenCalledWith('design')
  })
})
