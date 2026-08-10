import { within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { delay, http, HttpResponse } from 'msw'
import { afterEach } from 'vitest'
import { clearPendingTodoToken } from '../api/consistencyTokens'
import TodoSection from '../components/TodoSection'
import { render, screen, waitFor, act, fireEvent } from '../test/render'
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

const mkTodo = (id: string, description: string, addedAt: string) => ({
  itemId: id, type: 'todo' as const, noteId: null, noteTitle: null, description, addedAt, completedAt: null,
})
const alpha = mkTodo('t-a', 'Alpha', '2026-01-01T00:00:00Z')
const bravo = mkTodo('t-b', 'Bravo', '2026-01-01T00:00:01Z')
const charlie = mkTodo('t-c', 'Charlie', '2026-01-01T00:00:02Z')

describe('TodoSection — reorder (CHANGE-29: drag-only, no keyboard arrows)', () => {
  it('renders no Move up/down arrow buttons; rows stay draggable for pointer reorder', async () => {
    server.use(http.get('/api/todos', () => HttpResponse.json({ items: [alpha, bravo] })))
    render(<TodoSection />)
    await screen.findByText('Alpha')

    // CHANGE-29: the keyboard reorder arrows are removed (a11y tradeoff accepted — reorder is
    // pointer-only via the drag handle).
    expect(screen.queryByRole('button', { name: /move .* up/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /move .* down/i })).toBeNull()

    const rows = within(screen.getByTestId('todo-list')).getAllByRole('listitem')
    expect(rows[0]).toHaveAttribute('draggable', 'true')
  })
})

// 50-A — the Today line: a user-positioned marker that splits the open list into Today and
// Later. Nothing about it is derived from dates. Drag is fired directly: userEvent has no
// drag API, and the handlers under test never read `dataTransfer`.
describe('TodoSection — the Today line (50-A)', () => {
  const mkTodo = (id: string, description: string, addedAt: string) => ({
    itemId: id, type: 'todo' as const, noteId: null, noteTitle: null, description, addedAt, completedAt: null,
  })
  const one = mkTodo('t-1', 'One', '2026-01-01T00:00:01Z')
  const two = mkTodo('t-2', 'Two', '2026-01-01T00:00:02Z')
  const three = mkTodo('t-3', 'Three', '2026-01-01T00:00:03Z')
  const four = mkTodo('t-4', 'Four', '2026-01-01T00:00:04Z')
  const five = mkTodo('t-5', 'Five', '2026-01-01T00:00:05Z')
  const all = [one, two, three, four, five]

  function serveTodos(items: typeof all, todayLineAnchorItemId: string | null) {
    server.use(http.get('/api/todos', () => HttpResponse.json({ items, todayLineAnchorItemId })))
  }

  const todayTexts = () =>
    within(screen.getByTestId('todo-list')).getAllByRole('listitem').map((li) => li.textContent)
  const laterTexts = () =>
    within(screen.getByTestId('todo-later-list')).getAllByRole('listitem').map((li) => li.textContent)

  function drag(source: HTMLElement, target: HTMLElement) {
    fireEvent.dragStart(source)
    fireEvent.drop(target)
  }

  it('splits the list into Today and Later at the line', async () => {
    // Line after the second item → anchor is the third.
    serveTodos(all, 't-3')
    render(<TodoSection />)
    await screen.findByText('One')

    expect(todayTexts()).toHaveLength(2)
    expect(todayTexts().join(' ')).toContain('One')
    expect(todayTexts().join(' ')).toContain('Two')
    expect(laterTexts()).toHaveLength(3)
    expect(screen.getByRole('heading', { name: 'Today' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Later' })).toBeInTheDocument()
  })

  it('dragging the line down re-splits immediately, before the save completes', async () => {
    let posted: unknown = null
    serveTodos(all, 't-3')
    server.use(http.post('/api/todos/today-line', async ({ request }) => {
      posted = await request.json()
      // Never resolves for the lifetime of the test, so a passing assertion below can only be
      // the optimistic re-split — not the server echo.
      await delay('infinite')
      return HttpResponse.json({ consistencyToken: 'todo-order#__default__@2' })
    }))
    render(<TodoSection />)
    await screen.findByText('One')

    // Drop the line on the fifth item → four items are Today.
    drag(screen.getByTestId('today-line'), screen.getByRole('checkbox', { name: /Five/i }).closest('li')!)

    await waitFor(() => expect(todayTexts()).toHaveLength(4))
    await waitFor(() => expect(posted).toEqual({ anchorItemId: 't-5' }))
  })

  it('dragging the line onto the first item leaves nothing in today, with an empty state', async () => {
    serveTodos([one, two], 't-2')
    server.use(http.post('/api/todos/today-line', () =>
      HttpResponse.json({ consistencyToken: 'todo-order#__default__@2' })))
    render(<TodoSection />)
    await screen.findByText('One')

    drag(screen.getByTestId('today-line'), screen.getByRole('checkbox', { name: /One/i }).closest('li')!)

    await waitFor(() => expect(screen.getByTestId('todo-today-empty')).toBeInTheDocument())
    expect(screen.queryByTestId('todo-list')).toBeNull()
    expect(laterTexts()).toHaveLength(2)
  })

  it('an unset line puts everything in today and shows no Later group', async () => {
    serveTodos([one, two], null)
    render(<TodoSection />)
    await screen.findByText('One')

    expect(todayTexts()).toHaveLength(2)
    expect(screen.queryByTestId('todo-later-list')).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Later' })).toBeNull()
  })

  it('a response with no line field at all still renders (all today)', async () => {
    server.use(http.get('/api/todos', () => HttpResponse.json({ items: [one, two] })))
    render(<TodoSection />)
    await screen.findByText('One')

    expect(todayTexts()).toHaveLength(2)
    expect(screen.queryByTestId('todo-later-list')).toBeNull()
  })

  it('shows no Today line when there are no open items', async () => {
    serveTodos([], null)
    render(<TodoSection />)
    await screen.findByTestId('todo-empty')

    expect(screen.queryByTestId('today-line')).toBeNull()
  })

  it('dragging a Later item above the line moves it into Today and persists the new order', async () => {
    let posted: { orderedItemIds: string[] } | null = null
    serveTodos([one, two, three], 't-2')
    server.use(http.post('/api/todos/reorder', async ({ request }) => {
      posted = (await request.json()) as { orderedItemIds: string[] }
      return HttpResponse.json({ consistencyToken: 'todo-order#__default__@2' })
    }))
    render(<TodoSection />)
    await screen.findByText('One')
    expect(todayTexts()).toHaveLength(1)

    // Drop "Three" onto "One" — the only Today row — so it lands above the line.
    drag(
      screen.getByRole('checkbox', { name: /Three/i }).closest('li')!,
      screen.getByRole('checkbox', { name: /One/i }).closest('li')!,
    )

    await waitFor(() => expect(todayTexts()).toHaveLength(2))
    await waitFor(() => expect(posted).toEqual({ orderedItemIds: ['t-3', 't-1', 't-2'] }))
  })

  it('dropping a Later item on the line itself makes it the last Today item', async () => {
    let posted: { orderedItemIds: string[] } | null = null
    serveTodos([one, two, three], 't-2')
    server.use(http.post('/api/todos/reorder', async ({ request }) => {
      posted = (await request.json()) as { orderedItemIds: string[] }
      return HttpResponse.json({ consistencyToken: 'todo-order#__default__@2' })
    }))
    render(<TodoSection />)
    await screen.findByText('One')

    drag(screen.getByRole('checkbox', { name: /Three/i }).closest('li')!, screen.getByTestId('today-line'))

    await waitFor(() => expect(posted).toEqual({ orderedItemIds: ['t-1', 't-3', 't-2'] }))
    await waitFor(() => expect(todayTexts().join(' ')).toContain('Three'))
  })

  it('an end-of-list drop zone appears while dragging the line and sends it below everything', async () => {
    let posted: unknown = null
    serveTodos([one, two], 't-2')
    server.use(http.post('/api/todos/today-line', async ({ request }) => {
      posted = await request.json()
      return HttpResponse.json({ consistencyToken: 'todo-order#__default__@2' })
    }))
    render(<TodoSection />)
    await screen.findByText('One')
    expect(screen.queryByTestId('todo-list-end')).toBeNull()

    fireEvent.dragStart(screen.getByTestId('today-line'))
    fireEvent.drop(screen.getByTestId('todo-list-end'))

    await waitFor(() => expect(posted).toEqual({ anchorItemId: null }))
    await waitFor(() => expect(screen.queryByTestId('todo-later-list')).toBeNull())
  })

  it('a newly captured to-do lands at the top of the list, in Today', async () => {
    serveTodos([one, two, three], 't-3')
    server.use(http.post('/api/todos', () => HttpResponse.json({ todoId: 'new-1' })))
    render(<TodoSection />)
    await screen.findByText('One')

    await userEvent.type(await screen.findByPlaceholderText(/add a to-do/i), 'Fresh{Enter}')

    await waitFor(() => expect(todayTexts()[0]).toContain('Fresh'))
  })

  it('completing a Today item leaves the line where it was', async () => {
    serveTodos([one, two, three], 't-3')
    server.use(http.post('/api/todos/:id/complete', () => new HttpResponse(null, { status: 204 })))
    render(<TodoSection />)
    await screen.findByText('One')

    await userEvent.click(screen.getByRole('checkbox', { name: /Complete "Two"/i }))

    // "One" is still the only Today row; "Three" is still Later.
    await waitFor(() => expect(todayTexts()).toHaveLength(1))
    expect(todayTexts()[0]).toContain('One')
    expect(laterTexts()).toHaveLength(1)
  })

  it('deleting the anchor re-anchors the line to the next open item first', async () => {
    const calls: string[] = []
    serveTodos([one, two, three], 't-2')
    server.use(
      http.post('/api/todos/today-line', async ({ request }) => {
        calls.push(`line:${JSON.stringify(await request.json())}`)
        return HttpResponse.json({ consistencyToken: 'todo-order#__default__@2' })
      }),
      http.delete('/api/todos/:id', ({ params }) => {
        calls.push(`delete:${params.id as string}`)
        return new HttpResponse(null, { status: 204 })
      }),
    )
    render(<TodoSection />)
    await screen.findByText('Two')

    await userEvent.click(screen.getByRole('button', { name: /delete "Two"/i }))

    await waitFor(() => expect(calls).toEqual(['line:{"anchorItemId":"t-3"}', 'delete:t-2']))
  })
})


// 50-B moved these controls off the row and into the per-row actions menu, so every
// assertion here now drives them through that menu. The behaviours they lock in
// (order posted, busy guard, disabled edges, optimistic move, failure alert) are unchanged.
describe('TodoSection — send to top / bottom (CHANGE-34, via the 50-B actions menu)', () => {
  const openOrder = () =>
    within(screen.getByTestId('todo-list'))
      .getAllByRole('listitem')
      .map((row) => row.textContent)

  const menuTrigger = (description: string) =>
    screen.getByRole('button', { name: new RegExp(`actions for "${description}"`, 'i') })

  async function openMenu(description: string) {
    await userEvent.click(menuTrigger(description))
  }
  const sendToTop = () => screen.getByRole('menuitem', { name: /send to top/i })
  const sendToBottom = () => screen.getByRole('menuitem', { name: /send to bottom/i })

  // Tab from the document body until `target` holds focus, proving the control sits in the
  // natural tab order (a div+onClick or tabIndex={-1} control would never be reached).
  async function tabTo(target: HTMLElement) {
    for (let i = 0; i < 40; i++) {
      await userEvent.tab()
      if (document.activeElement === target) return true
    }
    return false
  }

  function listThenReorder(onBody: (body: unknown) => void) {
    server.use(
      http.get('/api/todos', () => HttpResponse.json({ items: [alpha, bravo, charlie] })),
      http.post('/api/todos/reorder', async ({ request }) => {
        onBody(await request.json())
        return HttpResponse.json({ consistencyToken: 'todo#t-b@2' })
      }),
    )
  }

  it('sends a middle row to the top and posts the new order', async () => {
    let body: unknown
    listThenReorder((b) => { body = b })
    render(<TodoSection />)
    await screen.findByText('Bravo')

    await openMenu('Bravo')
    await userEvent.click(sendToTop())

    await waitFor(() => expect(body).toEqual({ orderedItemIds: ['t-b', 't-a', 't-c'] }))
    expect(openOrder()).toEqual(['Bravo', 'Alpha', 'Charlie'])
  })

  // BUG-63: the send buttons were disabled only by POSITION, never by `busy` — so while one row's
  // reorder was still in flight a DIFFERENT row stayed clickable. Both mutations snapshot the cache
  // in onMutate, so a rollback restores a snapshot taken before the other applied and the list keeps
  // an order the server never stored (staleTime 30s + refetchOnWindowFocus off = never corrected).
  // Red before the fix: two POSTs, the second built from the pre-first order.
  it('ignores a second send while the first is still saving', async () => {
    const bodies: unknown[] = []
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => { release = resolve })
    server.use(
      http.get('/api/todos', () => HttpResponse.json({ items: [alpha, bravo, charlie] })),
      http.post('/api/todos/reorder', async ({ request }) => {
        bodies.push(await request.json())
        await gate
        return HttpResponse.json({ consistencyToken: 'todo#t-b@2' })
      }),
    )
    render(<TodoSection />)
    await screen.findByText('Bravo')

    await openMenu('Bravo')
    await userEvent.click(sendToTop())
    await waitFor(() => expect(bodies).toHaveLength(1))
    // Charlie is a DIFFERENT row and is NOT at the top, so no position rule disables this control —
    // only the busy lock can. (Picking sendToBottom on Charlie would prove nothing: Charlie is
    // already last, so that item is position-disabled and the test would pass without the fix.)
    await openMenu('Charlie')
    await userEvent.click(sendToTop())

    expect(bodies).toHaveLength(1)
    release?.()
    await waitFor(() => expect(bodies).toHaveLength(1))
  })

  it('sends a middle row to the bottom and posts the new order', async () => {
    let body: unknown
    listThenReorder((b) => { body = b })
    render(<TodoSection />)
    await screen.findByText('Bravo')

    await openMenu('Bravo')
    await userEvent.click(sendToBottom())

    await waitFor(() => expect(body).toEqual({ orderedItemIds: ['t-a', 't-c', 't-b'] }))
    expect(openOrder()).toEqual(['Alpha', 'Charlie', 'Bravo'])
  })

  it('the whole send-to-top path is reachable by keyboard alone', async () => {
    let body: unknown
    listThenReorder((b) => { body = b })
    render(<TodoSection />)
    await screen.findByText('Bravo')

    expect(await tabTo(menuTrigger('Bravo'))).toBe(true)
    await userEvent.keyboard('{Enter}')
    await userEvent.keyboard('{ArrowDown}')
    await userEvent.keyboard('{Enter}')

    await waitFor(() => expect(body).toEqual({ orderedItemIds: ['t-b', 't-a', 't-c'] }))
    expect(openOrder()).toEqual(['Bravo', 'Alpha', 'Charlie'])
  })

  it('the whole send-to-bottom path is reachable by keyboard alone', async () => {
    let body: unknown
    listThenReorder((b) => { body = b })
    render(<TodoSection />)
    await screen.findByText('Bravo')

    expect(await tabTo(menuTrigger('Bravo'))).toBe(true)
    await userEvent.keyboard('{ArrowDown}')
    await userEvent.keyboard('{ArrowDown}{ArrowDown}')
    await userEvent.keyboard(' ')

    await waitFor(() => expect(body).toEqual({ orderedItemIds: ['t-a', 't-c', 't-b'] }))
    expect(openOrder()).toEqual(['Alpha', 'Charlie', 'Bravo'])
  })

  it('offers the actions menu on open rows only, never on a completed row', async () => {
    server.use(
      http.get('/api/todos', () =>
        HttpResponse.json({ items: [alpha, bravo, completedTodayAction] })),
    )
    render(<TodoSection />)
    await screen.findByText('Alpha')
    await userEvent.click(screen.getByRole('button', { name: /done \(1\)/i }))
    expect(screen.getByText('Send recap')).toBeInTheDocument()

    expect(menuTrigger('Bravo')).toBeInTheDocument()
    expect(menuTrigger('Alpha')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /actions for "Send recap"/i })).toBeNull()
  })

  it('send to top on the first row is a no-op — no reorder request', async () => {
    let posts = 0
    listThenReorder(() => { posts++ })
    render(<TodoSection />)
    await screen.findByText('Alpha')

    await openMenu('Alpha')
    const control = sendToTop()
    expect(control).toHaveAttribute('aria-disabled', 'true')
    await userEvent.click(control)
    // Close first: an open menu's labels are part of its row's textContent. Clicking a
    // DISABLED item leaves focus on <body>, so Escape would never reach the menu.
    await userEvent.click(menuTrigger('Alpha'))

    expect(posts).toBe(0)
    expect(openOrder()).toEqual(['Alpha', 'Bravo', 'Charlie'])
  })

  it('send to bottom on the last row is a no-op — no reorder request', async () => {
    let posts = 0
    listThenReorder(() => { posts++ })
    render(<TodoSection />)
    await screen.findByText('Charlie')

    await openMenu('Charlie')
    const control = sendToBottom()
    expect(control).toHaveAttribute('aria-disabled', 'true')
    await userEvent.click(control)
    // Close first: an open menu's labels are part of its row's textContent. Clicking a
    // DISABLED item leaves focus on <body>, so Escape would never reach the menu.
    await userEvent.click(menuTrigger('Charlie'))

    expect(posts).toBe(0)
    expect(openOrder()).toEqual(['Alpha', 'Bravo', 'Charlie'])
  })

  it('moves the row before the request resolves, and reverts the order when it fails', async () => {
    let failReorder!: () => void
    server.use(
      http.get('/api/todos', () => HttpResponse.json({ items: [alpha, bravo, charlie] })),
      http.post('/api/todos/reorder', () =>
        new Promise<Response>((res) => { failReorder = () => res(new HttpResponse(null, { status: 500 })) })),
    )
    render(<TodoSection />)
    await screen.findByText('Charlie')

    await openMenu('Charlie')
    await userEvent.click(sendToTop())

    // The request is still pending here — the row has already moved.
    await waitFor(() => expect(openOrder()).toEqual(['Charlie', 'Alpha', 'Bravo']))

    await act(async () => { failReorder() })

    await waitFor(() => expect(openOrder()).toEqual(['Alpha', 'Bravo', 'Charlie']))
  })

  it('surfaces a failed reorder instead of silently reverting', async () => {
    server.use(
      http.get('/api/todos', () => HttpResponse.json({ items: [alpha, bravo, charlie] })),
      http.post('/api/todos/reorder', async () => {
        await delay(10)
        return new HttpResponse(null, { status: 500 })
      }),
    )
    render(<TodoSection />)
    await screen.findByText('Charlie')

    await openMenu('Charlie')
    await userEvent.click(sendToTop())

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/failed to reorder/i)
  })
})

describe('TodoSection — move a to-do across the Today line (50-B)', () => {
  const mk = (id: string, description: string, addedAt: string) => ({
    itemId: id, type: 'todo' as const, noteId: null, noteTitle: null, description, addedAt, completedAt: null,
  })
  const one = mk('t-1', 'One', '2026-01-01T00:00:01Z')
  const two = mk('t-2', 'Two', '2026-01-01T00:00:02Z')
  const three = mk('t-3', 'Three', '2026-01-01T00:00:03Z')
  const four = mk('t-4', 'Four', '2026-01-01T00:00:04Z')
  const five = mk('t-5', 'Five', '2026-01-01T00:00:05Z')
  const all = [one, two, three, four, five]

  const todayTexts = () =>
    within(screen.getByTestId('todo-list')).getAllByRole('listitem').map((li) => li.textContent)
  const laterTexts = () =>
    within(screen.getByTestId('todo-later-list')).getAllByRole('listitem').map((li) => li.textContent)

  const menuTrigger = (description: string) =>
    screen.getByRole('button', { name: new RegExp(`actions for "${description}"`, 'i') })
  const moveItem = () => screen.getByRole('menuitem', { name: /move to (today|later)/i })

  async function openMenu(description: string) {
    await userEvent.click(menuTrigger(description))
  }

  // Anchor t-4 → Today = [One, Two, Three], Later = [Four, Five].
  function serve(anchor: string | null, items = all) {
    server.use(
      http.get('/api/todos', () => HttpResponse.json({ items, todayLineAnchorItemId: anchor })),
      http.post('/api/todos/reorder', () => HttpResponse.json({ consistencyToken: 'todo-order#__default__@2' })),
      http.post('/api/todos/today-line', () => HttpResponse.json({ consistencyToken: 'todo-order#__default__@3' })),
    )
  }

  it('moving a Later item to Today lands it LAST in Today, not first', async () => {
    let order: unknown
    serve('t-4')
    server.use(http.post('/api/todos/reorder', async ({ request }) => {
      order = await request.json()
      return HttpResponse.json({ consistencyToken: 'todo-order#__default__@2' })
    }))
    render(<TodoSection />)
    await screen.findByText('One')

    await openMenu('Five')
    await userEvent.click(moveItem())

    await waitFor(() => expect(todayTexts()).toHaveLength(4))
    expect(todayTexts()[3]).toContain('Five')
    expect(laterTexts()).toHaveLength(1)
    await waitFor(() => expect(order).toEqual({ orderedItemIds: ['t-1', 't-2', 't-3', 't-5', 't-4'] }))
  })

  // Three is the LAST Today item, so from === to and no reorder is posted — this is the
  // line-write-only boundary case.
  it('moving the last Today item to Later re-anchors the line without reordering', async () => {
    let anchorBody: unknown
    let reorders = 0
    serve('t-4')
    server.use(
      http.post('/api/todos/reorder', () => {
        reorders++
        return HttpResponse.json({ consistencyToken: 'x' })
      }),
      http.post('/api/todos/today-line', async ({ request }) => {
        anchorBody = await request.json()
        return HttpResponse.json({ consistencyToken: 'todo-order#__default__@3' })
      }),
    )
    render(<TodoSection />)
    await screen.findByText('One')

    await openMenu('Three')
    await userEvent.click(moveItem())

    await waitFor(() => expect(laterTexts()[0]).toContain('Three'))
    expect(todayTexts()).toHaveLength(2)
    expect(laterTexts()).toHaveLength(3)
    // The line re-anchors to the moved row, which is what makes it the first Later item.
    await waitFor(() => expect(anchorBody).toEqual({ anchorItemId: 't-3' }))
    expect(reorders).toBe(0)
  })

  // One is NOT adjacent to the line, so the demote genuinely reorders — the arrayMove(from,
  // splitAt - 1) branch, which the boundary case above never reaches.
  it('moving a non-adjacent Today item to Later reorders AND re-anchors', async () => {
    let order: unknown
    let anchorBody: unknown
    serve('t-4')
    server.use(
      http.post('/api/todos/reorder', async ({ request }) => {
        order = await request.json()
        return HttpResponse.json({ consistencyToken: 'x' })
      }),
      http.post('/api/todos/today-line', async ({ request }) => {
        anchorBody = await request.json()
        return HttpResponse.json({ consistencyToken: 'y' })
      }),
    )
    render(<TodoSection />)
    await screen.findByText('One')

    await openMenu('One')
    await userEvent.click(moveItem())

    await waitFor(() => expect(laterTexts()[0]).toContain('One'))
    expect(todayTexts()).toHaveLength(2)
    expect(todayTexts().join(' ')).toContain('Two')
    expect(todayTexts().join(' ')).toContain('Three')
    await waitFor(() => expect(order).toEqual({ orderedItemIds: ['t-2', 't-3', 't-1', 't-4', 't-5'] }))
    await waitFor(() => expect(anchorBody).toEqual({ anchorItemId: 't-1' }))
  })

  // The half-failure that used to persist the row in a position the user never chose while
  // the message claimed nothing had moved.
  it('a failed line write reverts the reorder too, and says so once', async () => {
    serve('t-4')
    server.use(
      http.post('/api/todos/reorder', () => HttpResponse.json({ consistencyToken: 'x' })),
      http.post('/api/todos/today-line', async () => {
        await delay(10)
        return new HttpResponse(null, { status: 500 })
      }),
    )
    render(<TodoSection />)
    await screen.findByText('One')

    await openMenu('One')
    await userEvent.click(moveItem())

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/couldn't finish moving/i)
    // Server truth after the refetch: the reorder never landed, so One is back in Today.
    await waitFor(() => expect(todayTexts()).toHaveLength(3))
    expect(todayTexts()[0]).toContain('One')
    expect(laterTexts()).toHaveLength(2)
    expect(screen.getAllByRole('alert')).toHaveLength(1)
    // A failed move must not strand focus on <body>.
    await waitFor(() => expect(document.activeElement).toBe(menuTrigger('One')))
  })

  it('the action names the side the item is going to', async () => {
    serve('t-4')
    render(<TodoSection />)
    await screen.findByText('One')

    await openMenu('One')
    expect(screen.getByRole('menuitem', { name: /move to later/i })).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')

    await openMenu('Five')
    expect(screen.getByRole('menuitem', { name: /move to today/i })).toBeInTheDocument()
  })

  it('re-renders before the save completes', async () => {
    serve('t-4')
    server.use(http.post('/api/todos/reorder', async () => {
      // Never resolves, so a passing assertion below can only be the optimistic move.
      await delay('infinite')
      return HttpResponse.json({ consistencyToken: 'x' })
    }))
    render(<TodoSection />)
    await screen.findByText('One')

    await openMenu('Five')
    await userEvent.click(moveItem())

    await waitFor(() => expect(todayTexts()).toHaveLength(4))
  })

  it('moving the item the line is anchored to leaves the rest of Later alone', async () => {
    serve('t-4')
    render(<TodoSection />)
    await screen.findByText('One')

    // Four IS the anchor. Promoting it must step the line down to Five, not drag it along —
    // dragging it would swallow Five into Today too.
    await openMenu('Four')
    await userEvent.click(moveItem())

    await waitFor(() => expect(todayTexts()).toHaveLength(4))
    expect(todayTexts()[3]).toContain('Four')
    expect(laterTexts()).toHaveLength(1)
    expect(laterTexts()[0]).toContain('Five')
  })

  it('promoting the only Later item empties the group', async () => {
    serve('t-5')
    render(<TodoSection />)
    await screen.findByText('One')

    await openMenu('Five')
    await userEvent.click(moveItem())

    await waitFor(() => expect(todayTexts()).toHaveLength(5))
    expect(screen.queryByTestId('todo-later-list')).toBeNull()
  })

  it('a failed move reverts the list and tells the user', async () => {
    serve('t-4')
    server.use(http.post('/api/todos/reorder', async () => {
      await delay(10)
      return new HttpResponse(null, { status: 500 })
    }))
    render(<TodoSection />)
    await screen.findByText('One')

    await openMenu('Five')
    await userEvent.click(moveItem())

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/couldn't finish moving/i)
    await waitFor(() => expect(todayTexts()).toHaveLength(3))
    expect(laterTexts()).toHaveLength(2)
    await waitFor(() => expect(document.activeElement).toBe(menuTrigger('Five')))
  })

  it('click-outside closes the menu', async () => {
    serve('t-4')
    render(<TodoSection />)
    await screen.findByText('One')

    await openMenu('Five')
    expect(screen.queryAllByRole('menuitem')).toHaveLength(3)

    await userEvent.click(screen.getByRole('heading', { name: 'Today' }))

    expect(screen.queryByRole('menuitem')).toBeNull()
    expect(menuTrigger('Five')).toHaveAttribute('aria-expanded', 'false')
  })

  // Every action is unavailable while a save is in flight. The menu must still be enterable and
  // escapable by keyboard — a `disabled` attribute would make it focus-proof and Escape-proof.
  it('the menu is still keyboard-escapable when every action is unavailable', async () => {
    serve('t-4')
    server.use(http.post('/api/todos/reorder', async () => {
      await delay('infinite')
      return HttpResponse.json({ consistencyToken: 'x' })
    }))
    render(<TodoSection />)
    await screen.findByText('One')

    await openMenu('Five')
    await userEvent.click(moveItem())

    await openMenu('Four')
    expect(moveItem()).toHaveAttribute('aria-disabled', 'true')
    await userEvent.keyboard('{Escape}')

    expect(screen.queryByRole('menuitem')).toBeNull()
    expect(menuTrigger('Four')).toHaveAttribute('aria-expanded', 'false')
  })

  it('reopening a menu starts back at the first action', async () => {
    serve('t-4')
    render(<TodoSection />)
    await screen.findByText('One')

    // One is the first row, so "Send to top" is unavailable and the roving skips it —
    // a single ArrowDown lands on "Send to bottom", not on the unavailable item.
    await openMenu('One')
    await userEvent.keyboard('{ArrowDown}')
    expect(document.activeElement).toHaveTextContent(/send to bottom/i)
    await userEvent.keyboard('{Escape}')

    await openMenu('One')
    expect(document.activeElement).toHaveTextContent(/move to later/i)
  })

  it('Escape closes the menu, changes nothing, and returns focus to the trigger', async () => {
    let posts = 0
    serve('t-4')
    server.use(http.post('/api/todos/reorder', () => { posts++; return HttpResponse.json({ consistencyToken: 'x' }) }))
    render(<TodoSection />)
    await screen.findByText('One')

    await openMenu('Five')
    expect(moveItem()).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')

    expect(screen.queryByRole('menuitem')).toBeNull()
    expect(document.activeElement).toBe(menuTrigger('Five'))
    expect(posts).toBe(0)
    expect(todayTexts()).toHaveLength(3)
  })

  it('opening one row menu closes another', async () => {
    serve('t-4')
    render(<TodoSection />)
    await screen.findByText('One')

    await openMenu('One')
    expect(screen.getAllByRole('menuitem')).toHaveLength(3)
    await openMenu('Two')

    // Still exactly one open menu, and it belongs to the second row.
    expect(screen.getAllByRole('menuitem')).toHaveLength(3)
    expect(menuTrigger('Two')).toHaveAttribute('aria-expanded', 'true')
    expect(menuTrigger('One')).toHaveAttribute('aria-expanded', 'false')
  })

  it('the whole move is operable by keyboard, and focus returns to the trigger', async () => {
    serve('t-4')
    render(<TodoSection />)
    await screen.findByText('One')

    menuTrigger('Five').focus()
    await userEvent.keyboard('{ArrowDown}')
    await userEvent.keyboard('{Enter}')

    await waitFor(() => expect(todayTexts()).toHaveLength(4))
    expect(document.activeElement).toBe(menuTrigger('Five'))
  })

  it('delete stays on the row, not in the actions menu', async () => {
    serve('t-4')
    render(<TodoSection />)
    await screen.findByText('One')

    // Present on the row with the menu closed.
    expect(screen.getByRole('button', { name: /delete "Five"/i })).toBeInTheDocument()

    await openMenu('Five')
    expect(screen.queryByRole('menuitem', { name: /delete/i })).toBeNull()
  })

  it('the menu is not offered while the row itself is busy', async () => {
    serve('t-4')
    server.use(http.post('/api/todos/reorder', async () => {
      await delay('infinite')
      return HttpResponse.json({ consistencyToken: 'x' })
    }))
    render(<TodoSection />)
    await screen.findByText('One')

    await openMenu('Five')
    await userEvent.click(moveItem())

    // A second move while the first is in flight must not fire another reorder.
    await openMenu('Four')
    expect(moveItem()).toHaveAttribute('aria-disabled', 'true')
  })
})
