import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { NoteCard as NoteCardData } from '../api/notes'
import NoteCard from '../components/NoteCard'
import styles from '../components/NoteCard.module.css'

const base: NoteCardData = {
  noteId: 'note-1',
  title: 'Q1 Review',
  contentPreview: '',
  date: null,
  openActions: [],
  createdAt: '2026-01-01T00:00:00Z',
  lastModifiedAt: '2026-01-01T00:00:00Z',
  tags: [],
  folderId: null,
}

describe('NoteCard', () => {
  it('renders title and snippet', () => {
    render(<NoteCard card={{ ...base, contentPreview: 'We discussed quarterly targets' }} onEdit={() => {}} />)
    expect(screen.getByText('Q1 Review')).toBeInTheDocument()
    expect(screen.getByText('We discussed quarterly targets')).toBeInTheDocument()
  })

  it('does not render open action items on the summary card (CHANGE-10)', () => {
    const card: NoteCardData = {
      ...base,
      openActions: [{ actionId: 'a-1', description: 'Send recap email' }],
    }
    render(<NoteCard card={card} onEdit={() => {}} />)
    expect(screen.queryByText('Send recap email')).not.toBeInTheDocument()
  })

  it('renders tag pills without a "Tags" label (CHANGE-10)', () => {
    render(<NoteCard card={{ ...base, tags: ['work', 'planning'] }} onEdit={() => {}} />)
    expect(screen.getByText('work')).toBeInTheDocument()
    expect(screen.getByText('planning')).toBeInTheDocument()
    expect(screen.queryByText('Tags')).not.toBeInTheDocument()
  })

  it('does not render a snippet when contentPreview is empty', () => {
    const { container } = render(<NoteCard card={base} onEdit={() => {}} />)
    expect(container.querySelector(`.${styles.noteCardSnippet}`)).toBeNull()
  })

  it('calls onEdit when the edit icon button is clicked', async () => {
    const onEdit = vi.fn()
    render(<NoteCard card={base} onEdit={onEdit} />)
    await userEvent.click(screen.getByRole('button', { name: 'Edit note' }))
    expect(onEdit).toHaveBeenCalledWith('note-1')
  })

  it('note card has the draggable attribute', () => {
    render(<NoteCard card={base} onEdit={() => {}} />)
    expect(screen.getByRole('article')).toHaveAttribute('draggable', 'true')
  })

  it('dragStart stores the noteId in dataTransfer', () => {
    render(<NoteCard card={base} onEdit={() => {}} />)
    const dataTransfer = { setData: vi.fn(), effectAllowed: '' }
    fireEvent.dragStart(screen.getByRole('article'), { dataTransfer })
    expect(dataTransfer.setData).toHaveBeenCalledWith('text/plain', 'note-1')
  })

  it('shows no move control when there are no other workspaces (23-F)', () => {
    render(<NoteCard card={base} onEdit={() => {}} onMoveToWorkspace={() => {}} otherWorkspaces={[]} />)
    expect(screen.queryByRole('button', { name: /Move "Q1 Review"/ })).not.toBeInTheDocument()
  })

  it('moves the note to a chosen workspace (23-F)', async () => {
    const onMoveToWorkspace = vi.fn()
    render(
      <NoteCard
        card={base}
        onEdit={() => {}}
        onMoveToWorkspace={onMoveToWorkspace}
        otherWorkspaces={[
          { workspaceId: 'ws-work', name: 'Work' },
          { workspaceId: 'ws-clients', name: 'Clients' },
        ]}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Move "Q1 Review" to another workspace' }))
    await userEvent.click(screen.getByTestId('move-workspace-option-ws-clients'))
    expect(onMoveToWorkspace).toHaveBeenCalledWith('note-1', 'ws-clients')
  })
})
