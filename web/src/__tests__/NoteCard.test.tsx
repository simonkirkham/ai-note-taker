import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import NoteCard from '../components/NoteCard'
import type { NoteCard as NoteCardData } from '../api'

const base: NoteCardData = {
  noteId: 'note-1',
  title: 'Q1 Review',
  contentPreview: '',
  date: null,
  openActions: [],
  createdAt: '2026-01-01T00:00:00Z',
  tags: [],
  folderId: null,
}

describe('NoteCard', () => {
  it('renders title and snippet', () => {
    render(<NoteCard card={{ ...base, contentPreview: 'We discussed quarterly targets' }} onEdit={() => {}} />)
    expect(screen.getByText('Q1 Review')).toBeInTheDocument()
    expect(screen.getByText('We discussed quarterly targets')).toBeInTheDocument()
  })

  it('renders open action items', () => {
    const card: NoteCardData = {
      ...base,
      openActions: [{ actionId: 'a-1', description: 'Send recap email' }],
    }
    render(<NoteCard card={card} onEdit={() => {}} />)
    expect(screen.getByText('Send recap email')).toBeInTheDocument()
  })

  it('does not render a snippet when contentPreview is empty', () => {
    const { container } = render(<NoteCard card={base} onEdit={() => {}} />)
    expect(container.querySelector('.note-card-snippet')).toBeNull()
  })

  it('calls onEdit when Edit button is clicked', async () => {
    const onEdit = vi.fn()
    render(<NoteCard card={base} onEdit={onEdit} />)
    await userEvent.click(screen.getByRole('button', { name: 'Edit Note' }))
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
})
