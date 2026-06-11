import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import type { NoteCard as NoteCardData } from '../api/notes'
import App from '../App'
import { AuthProvider } from '../auth/AuthContext'
import { clearToken } from '../auth/tokenStore'
import ListView from '../components/ListView'
import { localTodayISO } from '../dates'
import { render, screen, waitFor } from '../test/render'
import { server } from '../test/setup'

// Dated today so both render in the home view by default; these tests exercise
// the delete affordance, not the today/older date filter.
const today = localTodayISO()

const card: NoteCardData = {
  noteId: 'note-1',
  title: 'Team sync',
  contentPreview: 'Weekly update',
  date: today,
  openActions: [],
  createdAt: '2026-01-01T00:00:00Z',
  lastModifiedAt: '2026-01-01T00:00:00Z',
  tags: [],
  folderId: null,
}

const card2: NoteCardData = {
  noteId: 'note-2',
  title: 'Project brief',
  contentPreview: '',
  date: today,
  openActions: [],
  createdAt: '2026-01-02T00:00:00Z',
  lastModifiedAt: '2026-01-02T00:00:00Z',
  tags: [],
  folderId: null,
}

const defaultProps = {
  cards: [card],
  loading: false,
  creating: false,
  createError: null,
  onNewNote: () => {},
  onEditNote: () => {},
  onOpenNote: () => {},
  onDeleteNote: () => {},
}

describe('NoteCard — delete affordance', () => {
  it('each note card shows a delete button', () => {
    render(<ListView {...defaultProps} />)
    expect(screen.getByRole('button', { name: /delete "Team sync"/i })).toBeInTheDocument()
  })

  it('clicking delete shows an inline confirmation — note not yet removed', async () => {
    render(<ListView {...defaultProps} />)
    await userEvent.click(screen.getByRole('button', { name: /delete "Team sync"/i }))
    expect(screen.getByRole('button', { name: /confirm delete/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument()
    expect(screen.getByText('Team sync')).toBeInTheDocument()
  })

  it('clicking Cancel dismisses the confirmation and leaves the note', async () => {
    render(<ListView {...defaultProps} />)
    await userEvent.click(screen.getByRole('button', { name: /delete "Team sync"/i }))
    await userEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(screen.queryByRole('button', { name: /confirm delete/i })).not.toBeInTheDocument()
    expect(screen.getByText('Team sync')).toBeInTheDocument()
  })

  it('clicking delete on one card does not show confirmation on another card', async () => {
    render(<ListView {...defaultProps} cards={[card, card2]} />)
    await userEvent.click(screen.getByRole('button', { name: /delete "Team sync"/i }))
    expect(screen.getAllByRole('button', { name: /confirm delete/i })).toHaveLength(1)
    expect(screen.getByRole('button', { name: /delete "Project brief"/i })).toBeInTheDocument()
  })

  it('confirming removes the note optimistically and calls onDeleteNote', async () => {
    const onDeleteNote = vi.fn()
    render(<ListView {...defaultProps} onDeleteNote={onDeleteNote} />)
    await userEvent.click(screen.getByRole('button', { name: /delete "Team sync"/i }))
    await userEvent.click(screen.getByRole('button', { name: /confirm delete/i }))
    expect(screen.queryByText('Team sync')).not.toBeInTheDocument()
    expect(onDeleteNote).toHaveBeenCalledWith('note-1')
  })
})

describe('NoteCard — delete from the home list (App integration)', () => {
  afterEach(() => clearToken())

  it('confirming calls DELETE /notes/:noteId via the parent mutation', async () => {
    let called = false
    server.use(
      http.get('/api/w/:wsId/notes/cards', () => HttpResponse.json({ cards: [card] })),
      http.delete('/api/w/:wsId/notes/note-1', () => {
        called = true
        return new HttpResponse(null, { status: 204 })
      }),
    )
    render(<AuthProvider initialToken="test-token"><App /></AuthProvider>)
    await userEvent.click(await screen.findByRole('button', { name: /delete "Team sync"/i }))
    await userEvent.click(screen.getByRole('button', { name: /confirm delete/i }))
    // NoteCard is presentational now; the home list's onDeleteNote drives the
    // useDeleteNote mutation, which fires DELETE.
    await waitFor(() => expect(called).toBe(true))
  })
})
