import { within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { delay, http, HttpResponse } from 'msw'
import { afterEach } from 'vitest'
import { clearPendingTodoToken } from '../api/consistencyTokens'
import TodoSection from '../components/TodoSection'
import { render, screen, waitFor, act } from '../test/render'
import { server } from '../test/setup'

// The RYW pending-token store is module-global; clear it between tests.
afterEach(() => clearPendingTodoToken())

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

  it('announces an add failure as an alert (19-F1)', async () => {
    server.use(
      http.get('/api/todos', () => HttpResponse.json({ items: [] })),
      http.post('/api/todos', () => new HttpResponse(null, { status: 500 })),
    )
    render(<TodoSection />)
    const input = await screen.findByPlaceholderText(/add a to-do/i)
    await userEvent.type(input, 'Call dentist{Enter}')
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/failed to add to-do/i)
  })

  it('keeps the optimistic temp row visible while a stale refetch retries (RYW-1)', async () => {
    let gets = 0
    server.use(
      http.get('/api/todos', () => {
        gets++
        // Every refetch comes back stale: the optimistic row must stay visible throughout
        // the bounded retries and after they are exhausted.
        return HttpResponse.json({ items: [] }, { headers: { 'X-Consistency': 'stale' } })
      }),
      http.post('/api/todos', () =>
        HttpResponse.json({ todoId: 'srv-id', consistencyToken: 'todo#srv-id@2' })),
    )
    render(<TodoSection />)
    const input = await screen.findByPlaceholderText(/add a to-do/i)
    await userEvent.type(input, 'Persist me{Enter}')
    // The optimistic row is present immediately and remains so while refetches stay stale.
    expect(screen.getByText('Persist me')).toBeInTheDocument()
    await waitFor(() => expect(gets).toBeGreaterThanOrEqual(1))
    expect(screen.getByText('Persist me')).toBeInTheDocument()
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

  it('a long note-derived item still exposes its description, note title, and Delete control', async () => {
    const longItem = {
      ...openAction,
      itemId: 'a-long',
      description: 'Follow up with the candidate about the offer and the revised start date before end of week',
      noteTitle: 'Head of Technical Delivery – Finova',
    }
    server.use(http.get('/api/todos', () => HttpResponse.json({ items: [longItem] })))
    render(<TodoSection />)
    expect(await screen.findByText(longItem.description)).toBeInTheDocument()
    expect(screen.getByText('Head of Technical Delivery – Finova')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: new RegExp(`delete "${longItem.description}"`, 'i') })).toBeInTheDocument()
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

describe('TodoSection — edit', () => {
  it('editing a standalone todo saves via PUT /todos/:id and shows it optimistically', async () => {
    let putBody: unknown
    server.use(
      http.get('/api/todos', () => HttpResponse.json({ items: [openTodo] })),
      http.put('/api/todos/:todoId', async ({ request }) => { putBody = await request.json(); return new HttpResponse(null, { status: 204 }) }),
    )
    render(<TodoSection />)
    await userEvent.click(await screen.findByTestId('todo-description-t-1'))
    const input = await screen.findByTestId('edit-todo-input-t-1')
    await userEvent.clear(input)
    await userEvent.type(input, 'Buy oat milk{Enter}')
    await waitFor(() => expect(putBody).toEqual({ description: 'Buy oat milk' }))
    expect(await screen.findByTestId('todo-description-t-1')).toHaveTextContent('Buy oat milk')
  })

  it('editing a note action from the todo list saves via the action endpoint', async () => {
    let called = false
    server.use(
      http.get('/api/todos', () => HttpResponse.json({ items: [openAction] })),
      http.put('/api/notes/:noteId/actions/:actionId', () => { called = true; return new HttpResponse(null, { status: 200 }) }),
    )
    render(<TodoSection />)
    await userEvent.click(await screen.findByTestId('todo-description-a-1'))
    const input = await screen.findByTestId('edit-todo-input-a-1')
    await userEvent.clear(input)
    await userEvent.type(input, 'Chase the invoice{Enter}')
    await waitFor(() => expect(called).toBe(true))
  })

  it('Escape cancels editing without calling PUT', async () => {
    let called = false
    server.use(
      http.get('/api/todos', () => HttpResponse.json({ items: [openTodo] })),
      http.put('/api/todos/:todoId', () => { called = true; return new HttpResponse(null, { status: 204 }) }),
    )
    render(<TodoSection />)
    await userEvent.click(await screen.findByTestId('todo-description-t-1'))
    await userEvent.type(await screen.findByTestId('edit-todo-input-t-1'), ' extra{Escape}')
    expect(called).toBe(false)
    expect(await screen.findByTestId('todo-description-t-1')).toHaveTextContent('Buy milk')
  })

  it('clearing to empty does not call PUT', async () => {
    let called = false
    server.use(
      http.get('/api/todos', () => HttpResponse.json({ items: [openTodo] })),
      http.put('/api/todos/:todoId', () => { called = true; return new HttpResponse(null, { status: 204 }) }),
    )
    render(<TodoSection />)
    await userEvent.click(await screen.findByTestId('todo-description-t-1'))
    const input = await screen.findByTestId('edit-todo-input-t-1')
    await userEvent.clear(input)
    await userEvent.type(input, '{Enter}')
    expect(called).toBe(false)
    expect(await screen.findByTestId('todo-description-t-1')).toHaveTextContent('Buy milk')
  })

  it('Enter saves with exactly one PUT (editingRef guards a blur double-commit)', async () => {
    let puts = 0
    server.use(
      http.get('/api/todos', () => HttpResponse.json({ items: [openTodo] })),
      http.put('/api/todos/:todoId', () => { puts++; return new HttpResponse(null, { status: 204 }) }),
    )
    render(<TodoSection />)
    await userEvent.click(await screen.findByTestId('todo-description-t-1'))
    const input = await screen.findByTestId('edit-todo-input-t-1')
    await userEvent.clear(input)
    await userEvent.type(input, 'Buy oat milk{Enter}')
    await waitFor(() => expect(puts).toBe(1))
    expect(puts).toBe(1)
  })

  it('committing unchanged text does not call PUT', async () => {
    let called = false
    server.use(
      http.get('/api/todos', () => HttpResponse.json({ items: [openTodo] })),
      http.put('/api/todos/:todoId', () => { called = true; return new HttpResponse(null, { status: 204 }) }),
    )
    render(<TodoSection />)
    await userEvent.click(await screen.findByTestId('todo-description-t-1'))
    await userEvent.type(await screen.findByTestId('edit-todo-input-t-1'), '{Enter}')
    expect(called).toBe(false)
  })

  it('edit reverts to the original text when the request fails', async () => {
    let rejectPut!: () => void
    server.use(
      http.get('/api/todos', () => HttpResponse.json({ items: [openTodo] })),
      http.put('/api/todos/:todoId', () => new Promise<Response>((res) => { rejectPut = () => res(new HttpResponse(null, { status: 500 })) })),
    )
    render(<TodoSection />)
    await userEvent.click(await screen.findByTestId('todo-description-t-1'))
    const input = await screen.findByTestId('edit-todo-input-t-1')
    await userEvent.clear(input)
    await userEvent.type(input, 'New text{Enter}')
    expect(await screen.findByText('New text')).toBeInTheDocument()
    await act(async () => { rejectPut() })
    await waitFor(() => expect(screen.queryByText('New text')).not.toBeInTheDocument())
    expect(screen.getByText('Buy milk')).toBeInTheDocument()
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

describe('TodoSection — reorder', () => {
  const mkTodo = (id: string, description: string, addedAt: string) => ({
    itemId: id, type: 'todo' as const, noteId: null, noteTitle: null, description, addedAt, completedAt: null,
  })
  const alpha = mkTodo('t-a', 'Alpha', '2026-01-01T00:00:00Z')
  const bravo = mkTodo('t-b', 'Bravo', '2026-01-01T00:00:01Z')
  const charlie = mkTodo('t-c', 'Charlie', '2026-01-01T00:00:02Z')

  function openOrder() {
    return within(screen.getByTestId('todo-list'))
      .getAllByText(/Alpha|Bravo|Charlie/)
      .map((e) => e.textContent)
  }

  it('keyboard Move down reorders optimistically and posts the full new order', async () => {
    let posted: string[] | null = null
    server.use(
      http.get('/api/todos', () => HttpResponse.json({ items: [alpha, bravo, charlie] })),
      http.post('/api/todos/reorder', async ({ request }) => {
        posted = ((await request.json()) as { orderedItemIds: string[] }).orderedItemIds
        return HttpResponse.json({ consistencyToken: 'todo-order#__default__@1' })
      }),
    )
    render(<TodoSection />)
    await screen.findByText('Alpha')

    await userEvent.click(screen.getByRole('button', { name: /move "Alpha" down/i }))

    expect(openOrder()).toEqual(['Bravo', 'Alpha', 'Charlie'])
    await waitFor(() => expect(posted).toEqual(['t-b', 't-a', 't-c']))
  })

  it('Move up is disabled on the first item and Move down on the last', async () => {
    server.use(http.get('/api/todos', () => HttpResponse.json({ items: [alpha, bravo, charlie] })))
    render(<TodoSection />)
    await screen.findByText('Alpha')

    expect(screen.getByRole('button', { name: /move "Alpha" up/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /move "Charlie" down/i })).toBeDisabled()
  })

  it('rolls back the optimistic reorder on API failure', async () => {
    server.use(
      http.get('/api/todos', () => HttpResponse.json({ items: [alpha, bravo, charlie] })),
      http.post('/api/todos/reorder', async () => { await delay(20); return new HttpResponse(null, { status: 500 }) }),
    )
    render(<TodoSection />)
    await screen.findByText('Alpha')

    await userEvent.click(screen.getByRole('button', { name: /move "Alpha" down/i }))
    expect(openOrder()).toEqual(['Bravo', 'Alpha', 'Charlie'])

    await waitFor(() => expect(openOrder()).toEqual(['Alpha', 'Bravo', 'Charlie']))
  })
})
