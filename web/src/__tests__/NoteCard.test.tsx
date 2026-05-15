import { render, screen } from '@testing-library/react'
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

  it('calls onEdit when Edit button is clicked', async () => {
    const onEdit = vi.fn()
    render(<NoteCard card={base} onEdit={onEdit} />)
    await userEvent.click(screen.getByRole('button', { name: 'Edit Note' }))
    expect(onEdit).toHaveBeenCalledWith('note-1')
  })
})
