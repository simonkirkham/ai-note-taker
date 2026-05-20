import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { delay, http, HttpResponse } from 'msw'
import { server } from '../test/setup'
import TodoSection from '../components/TodoSection'

const today = new Date().toISOString()
const yesterday = new Date(Date.now() - 86_400_001).toISOString()

const openAction = {
  itemId: 'a-1',
  type: 'action' as const,
  noteId: 'n-1',
  noteTitle: 'Meeting Notes',
  description: 'Chase invoice',
  addedAt: '2026-01-01T00:00:00Z',
  completedAt: null,
}
const openTodo = {
  itemId: 't-1',
  type: 'todo' as const,
  noteId: null,
  noteTitle: null,
  description: 'Buy milk',
  addedAt: '2026-01-01T00:00:01Z',
  completedAt: null,
}
const completedTodayAction = {
  itemId: 'a-2',
  type: 'action' as const,
  noteId: 'n-1',
  noteTitle: 'Meeting Notes',
  description: 'Send recap',
  addedAt: '2026-01-01T00:00:02Z',
  completedAt: today,
}

describe('TodoSection — quick add', () => {
  it('renders an always-visible add input', async () => {
    server.use(http.get('/api/todos', () => HttpResponse.json({ items: [] })))
    render(<TodoSection />)
    expect(await screen.findByPlaceholderText(/add a to-do/i)).toBeInTheDocument()
  })

  it('submitting on Enter adds item optimistically and clears input', async () => {
    let posted = false
    server.use(
      http.get('/api/todos', () => HttpResponse.json({ items: [] })),
      http.post('/api/todos', () => {
        posted = true
        return HttpResponse.json({ todoId: 'new-t-1' })
      }),
    )
    render(<TodoSection />)
    const input = await screen.findByPlaceholderText(/add a to-do/i)
    await userEvent.type(input, 'Call dentist{Enter}')
    expect(screen.getByText('Call dentist')).toBeInTheDocument()
    await waitFor(() => expect(posted).toBe(true))
    expect(input).toHaveValue('')
  })

  it('clicking Add button submits the input', async () => {
    let posted = false
    server.use(
      http.get('/api/todos', () => HttpResponse.json({ items: [] })),
      http.post('/api/todos', () => {
        posted = true
        return HttpResponse.json({ todoId: 'new-t-2' })
      }),
    )
    render(<TodoSection />)
    const input = await screen.findByPlaceholderText(/add a to-do/i)
    await userEvent.type(input, 'Book dentist')
    await userEvent.click(screen.getByRole('button', { name: /add/i }))
    await waitFor(() => expect(posted).toBe(true))
    expect(screen.getByText('Book dentist')).toBeInTheDocument()
  })

  it('empty input is a no-op', async () => {
    let posted = false
    server.use(
      http.get('/api/todos', () => HttpResponse.json({ items: [] })),
      http.post('/api/todos', () => { posted = true; return HttpResponse.json({ todoId: 'x' }) }),
    )
    render(<TodoSection />)
    const input = await screen.findByPlaceholderText(/add a to-do/i)
    await userEvent.type(input, '{Enter}')
    expect(posted).toBe(false)
  })

  it('rolls back optimistic item on API failure', async () => {
    server.use(
      http.get('/api/todos', () => HttpResponse.json({ items: [] })),
      http.post('/api/todos', async () => { await delay(20); return new HttpResponse(null, { status: 500 }) }),
    )
    render(<TodoSection />)
    const input = await screen.findByPlaceholderText(/add a to-do/i)
    await userEvent.type(input, 'Call dentist{Enter}')
    await screen.findByText('Call dentist')
    await waitFor(() => expect(screen.queryByText('Call dentist')).not.toBeInTheDocument())
  })

  it('replaces temp id with server id on successful add', async () => {
    server.use(
      http.get('/api/todos', () => HttpResponse.json({ items: [] })),
      http.post('/api/todos', () => HttpResponse.json({ todoId: 'server-real-id' })),
    )
    render(<TodoSection />)
    const input = await screen.findByPlaceholderText(/add a to-do/i)
    await userEvent.type(input, 'My task{Enter}')
    await waitFor(() => {
      const checkboxes = screen.queryAllByRole('checkbox')
      expect(checkboxes.length).toBe(1)
    })
  })
})

describe('TodoSection — open items', () => {
  it('renders open items from the API', async () => {
    server.use(http.get('/api/todos', () => HttpResponse.json({ items: [openAction, openTodo] })))
    render(<TodoSection />)
    expect(await screen.findByText('Chase invoice')).toBeInTheDocument()
    expect(screen.getByText('Buy milk')).toBeInTheDocument()
  })

  it('note-based items show noteTitle; standalone items do not', async () => {
    server.use(http.get('/api/todos', () => HttpResponse.json({ items: [openAction, openTodo] })))
    render(<TodoSection />)
    expect(await screen.findByText('Meeting Notes')).toBeInTheDocument()
    expect(screen.queryAllByText('Meeting Notes')).toHaveLength(1)
  })

  it('completing a note action calls the note action endpoint and moves item to Done', async () => {
    let called = false
    server.use(
      http.get('/api/todos', () => HttpResponse.json({ items: [openAction] })),
      http.post('/api/notes/:noteId/actions/:actionId/complete', () => { called = true; return new HttpResponse(null, { status: 200 }) }),
    )
    render(<TodoSection />)
    const checkbox = await screen.findByRole('checkbox', { name: /Chase invoice/i })
    await userEvent.click(checkbox)
    await waitFor(() => expect(called).toBe(true))
    await waitFor(() => expect(screen.queryByRole('checkbox', { name: /Chase invoice/i })).not.toBeInTheDocument())
  })

  it('completing a standalone todo calls POST /todos/:id/complete', async () => {
    let called = false
    server.use(
      http.get('/api/todos', () => HttpResponse.json({ items: [openTodo] })),
      http.post('/api/todos/:todoId/complete', () => { called = true; return new HttpResponse(null, { status: 204 }) }),
    )
    render(<TodoSection />)
    const checkbox = await screen.findByRole('checkbox', { name: /Buy milk/i })
    await userEvent.click(checkbox)
    await waitFor(() => expect(called).toBe(true))
  })

  it('delete on an open action item calls delete endpoint and removes it', async () => {
    let called = false
    server.use(
      http.get('/api/todos', () => HttpResponse.json({ items: [openAction] })),
      http.delete('/api/notes/:noteId/actions/:actionId', () => { called = true; return new HttpResponse(null, { status: 204 }) }),
    )
    render(<TodoSection />)
    await screen.findByText('Chase invoice')
    await userEvent.click(screen.getByRole('button', { name: /delete "Chase invoice"/i }))
    await waitFor(() => expect(called).toBe(true))
    expect(screen.queryByText('Chase invoice')).not.toBeInTheDocument()
  })

  it('delete on a standalone todo calls DELETE /todos/:id', async () => {
    let called = false
    server.use(
      http.get('/api/todos', () => HttpResponse.json({ items: [openTodo] })),
      http.delete('/api/todos/:todoId', () => { called = true; return new HttpResponse(null, { status: 204 }) }),
    )
    render(<TodoSection />)
    await screen.findByText('Buy milk')
    await userEvent.click(screen.getByRole('button', { name: /delete "Buy milk"/i }))
    await waitFor(() => expect(called).toBe(true))
    expect(screen.queryByText('Buy milk')).not.toBeInTheDocument()
  })
})

describe('TodoSection — Done section', () => {
  it('Done section is collapsed by default and shows count', async () => {
    server.use(http.get('/api/todos', () => HttpResponse.json({ items: [openAction, completedTodayAction] })))
    render(<TodoSection />)
    await screen.findByText('Chase invoice')
    expect(screen.getByRole('button', { name: /done \(1\)/i })).toBeInTheDocument()
    expect(screen.queryByText('Send recap')).not.toBeInTheDocument()
  })

  it('clicking Done toggle expands the Done section', async () => {
    server.use(http.get('/api/todos', () => HttpResponse.json({ items: [openAction, completedTodayAction] })))
    render(<TodoSection />)
    await screen.findByText('Chase invoice')
    await userEvent.click(screen.getByRole('button', { name: /done \(1\)/i }))
    expect(screen.getByText('Send recap')).toBeInTheDocument()
  })

  it('items completed yesterday do not appear in Done', async () => {
    const oldItem = { ...completedTodayAction, itemId: 'a-old', completedAt: yesterday }
    server.use(http.get('/api/todos', () => HttpResponse.json({ items: [openAction, oldItem] })))
    render(<TodoSection />)
    await screen.findByText('Chase invoice')
    expect(screen.queryByRole('button', { name: /done/i })).not.toBeInTheDocument()
  })

  it('reopening a done item moves it back to the open list', async () => {
    let called = false
    server.use(
      http.get('/api/todos', () => HttpResponse.json({ items: [completedTodayAction] })),
      http.post('/api/notes/:noteId/actions/:actionId/reopen', () => { called = true; return new HttpResponse(null, { status: 200 }) }),
    )
    render(<TodoSection />)
    await userEvent.click(await screen.findByRole('button', { name: /done \(1\)/i }))
    await userEvent.click(screen.getByRole('button', { name: /reopen "Send recap"/i }))
    await waitFor(() => expect(called).toBe(true))
    expect(screen.getByRole('checkbox', { name: /Send recap/i })).toBeInTheDocument()
  })

  it('deleting from the Done section removes the item', async () => {
    let called = false
    server.use(
      http.get('/api/todos', () => HttpResponse.json({ items: [completedTodayAction] })),
      http.delete('/api/notes/:noteId/actions/:actionId', () => { called = true; return new HttpResponse(null, { status: 204 }) }),
    )
    render(<TodoSection />)
    await userEvent.click(await screen.findByRole('button', { name: /done \(1\)/i }))
    await userEvent.click(screen.getByRole('button', { name: /delete "Send recap"/i }))
    await waitFor(() => expect(called).toBe(true))
    expect(screen.queryByText('Send recap')).not.toBeInTheDocument()
  })

  it('rolls back reopen to original completedAt on API failure', async () => {
    server.use(
      http.get('/api/todos', () => HttpResponse.json({ items: [completedTodayAction] })),
      http.post('/api/notes/:noteId/actions/:actionId/reopen', async () => {
        await delay(20)
        return new HttpResponse(null, { status: 500 })
      }),
    )
    render(<TodoSection />)
    await userEvent.click(await screen.findByRole('button', { name: /done \(1\)/i }))
    await userEvent.click(screen.getByRole('button', { name: /reopen "Send recap"/i }))
    // item moves to open list optimistically
    await screen.findByRole('checkbox', { name: /Send recap/i })
    // then rolls back to done list
    await waitFor(() => expect(screen.queryByRole('checkbox', { name: /Send recap/i })).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: /done \(1\)/i })).toBeInTheDocument()
  })
})
