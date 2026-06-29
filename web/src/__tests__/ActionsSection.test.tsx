import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import ActionsSection from '../components/ActionsSection'
import TodoSection from '../components/TodoSection'
import { render, screen, waitFor, within, act } from '../test/render'
import { server } from '../test/setup'

const NOTE_ID = 'note-1'
const action1 = { actionId: 'a-1', description: 'Book meeting', completed: false, addedAt: '2026-01-01T00:00:00Z', completedAt: null }
const action1done = { ...action1, completed: true, completedAt: '2026-01-02T00:00:00Z' }

function renderActions() {
  return render(<ActionsSection noteId={NOTE_ID} />)
}

describe('ActionsSection', () => {
  it('shows empty state when no actions exist', async () => {
    renderActions()
    const empty = await screen.findByTestId('actions-empty')
    expect(empty).toBeInTheDocument()
    expect(empty).toHaveAttribute('role', 'status') // 19-F1
  })

  it('does not render an add-action button', async () => {
    renderActions()
    await screen.findByTestId('actions-empty')
    expect(screen.queryByTestId('add-action-button')).toBeNull()
  })

  it('Enter key adds item and clears the input', async () => {
    let postCalled = false
    // Add invalidates keys.actions → the onSettled refetch must include the new
    // action, or it would revert the optimistic add (temp-id→real-id swap).
    server.use(
      http.post(`/api/notes/${NOTE_ID}/actions`, async () => {
        postCalled = true
        return HttpResponse.json({ actionId: 'new-1' }, { status: 201 })
      }),
      http.get(`/api/notes/${NOTE_ID}/actions`, () =>
        HttpResponse.json({ actions: postCalled ? [{ ...action1, actionId: 'new-1', description: 'Book meeting' }] : [] })),
    )
    renderActions()
    await screen.findByTestId('actions-empty')
    const input = screen.getByTestId('action-input')
    await userEvent.type(input, 'Book meeting{Enter}')
    await waitFor(() => expect(postCalled).toBe(true))
    // The real-id test id only appears after the onSettled refetch swaps temp→new-1
    expect(await screen.findByTestId('action-description-new-1')).toHaveTextContent('Book meeting')
    expect(screen.queryByTestId(/action-description-temp-/)).not.toBeInTheDocument()
    expect((input as HTMLInputElement).value).toBe('')
  })

  it('blur on non-empty input adds the item', async () => {
    let postCalled = false
    server.use(
      http.post(`/api/notes/${NOTE_ID}/actions`, async () => {
        postCalled = true
        return HttpResponse.json({ actionId: 'new-2' }, { status: 201 })
      }),
      http.get(`/api/notes/${NOTE_ID}/actions`, () =>
        HttpResponse.json({ actions: postCalled ? [{ ...action1, actionId: 'new-2', description: 'Book the room' }] : [] })),
    )
    renderActions()
    await screen.findByTestId('actions-empty')
    const input = screen.getByTestId('action-input')
    await userEvent.type(input, 'Book the room')
    await userEvent.tab()
    await waitFor(() => expect(postCalled).toBe(true))
    await waitFor(() => expect(screen.getByText('Book the room')).toBeInTheDocument())
  })

  it('blur on empty input does not call POST', async () => {
    let postCalled = false
    server.use(
      http.post(`/api/notes/${NOTE_ID}/actions`, () => {
        postCalled = true
        return HttpResponse.json({ actionId: 'x' }, { status: 201 })
      }),
    )
    renderActions()
    await screen.findByTestId('actions-empty')
    const input = screen.getByTestId('action-input')
    await userEvent.click(input)
    await userEvent.tab()
    expect(postCalled).toBe(false)
    expect(screen.getByTestId('actions-empty')).toBeInTheDocument()
  })

  it('completing an action calls POST /complete and marks checkbox checked', async () => {
    let completeCalled = false
    server.use(
      http.get(`/api/notes/${NOTE_ID}/actions`, () => HttpResponse.json({ actions: [action1] })),
      http.post(`/api/notes/${NOTE_ID}/actions/:actionId/complete`, () => {
        completeCalled = true
        return new HttpResponse(null, { status: 200 })
      }),
    )
    renderActions()
    const checkbox = await screen.findByRole('checkbox', { name: /Book meeting/i })
    expect(checkbox).not.toBeChecked()
    await userEvent.click(checkbox)
    await waitFor(() => expect(completeCalled).toBe(true))
    await waitFor(() => expect(checkbox).toBeChecked())
  })

  it('reopening a completed action calls POST /reopen and unchecks the checkbox', async () => {
    let reopenCalled = false
    server.use(
      http.get(`/api/notes/${NOTE_ID}/actions`, () => HttpResponse.json({ actions: [action1done] })),
      http.post(`/api/notes/${NOTE_ID}/actions/:actionId/reopen`, () => {
        reopenCalled = true
        return new HttpResponse(null, { status: 200 })
      }),
    )
    renderActions()
    const checkbox = await screen.findByRole('checkbox', { name: /Book meeting/i })
    expect(checkbox).toBeChecked()
    await userEvent.click(checkbox)
    await waitFor(() => expect(reopenCalled).toBe(true))
    await waitFor(() => expect(checkbox).not.toBeChecked())
  })

  it('deleting an action calls DELETE and removes it from the list', async () => {
    let deleteCalled = false
    server.use(
      http.get(`/api/notes/${NOTE_ID}/actions`, () => HttpResponse.json({ actions: [action1] })),
      http.delete(`/api/notes/${NOTE_ID}/actions/:actionId`, () => {
        deleteCalled = true
        return new HttpResponse(null, { status: 204 })
      }),
    )
    renderActions()
    const deleteBtn = await screen.findByTestId('delete-action-a-1')
    await userEvent.click(deleteBtn)
    await waitFor(() => expect(deleteCalled).toBe(true))
    await waitFor(() => expect(screen.queryByText('Book meeting')).not.toBeInTheDocument())
    expect(screen.getByTestId('actions-empty')).toBeInTheDocument()
  })

  it('add rolls back the optimistic row when the request fails', async () => {
    let rejectPost!: () => void
    server.use(
      http.post(`/api/notes/${NOTE_ID}/actions`, () =>
        new Promise<Response>((res) => {
          rejectPost = () => res(new HttpResponse(null, { status: 500 }))
        })),
    )
    renderActions()
    await screen.findByTestId('actions-empty')
    await userEvent.type(screen.getByTestId('action-input'), 'Book meeting{Enter}')
    // Optimistic row appears…
    expect(await screen.findByText('Book meeting')).toBeInTheDocument()
    // …then is removed on failure
    await act(async () => { rejectPost() })
    await waitFor(() => expect(screen.queryByText('Book meeting')).not.toBeInTheDocument())
  })

  it('completing an action reverts to open when the request fails', async () => {
    let rejectComplete!: () => void
    server.use(
      http.get(`/api/notes/${NOTE_ID}/actions`, () => HttpResponse.json({ actions: [action1] })),
      http.post(`/api/notes/${NOTE_ID}/actions/:actionId/complete`, () =>
        new Promise<Response>((res) => {
          rejectComplete = () => res(new HttpResponse(null, { status: 500 }))
        })),
    )
    renderActions()
    const checkbox = await screen.findByRole('checkbox', { name: /Book meeting/i })
    await userEvent.click(checkbox)
    await waitFor(() => expect(checkbox).toBeChecked())
    await act(async () => { rejectComplete() })
    await waitFor(() => expect(checkbox).not.toBeChecked())
  })

  it('deleting an action restores it when the request fails', async () => {
    let rejectDelete!: () => void
    server.use(
      http.get(`/api/notes/${NOTE_ID}/actions`, () => HttpResponse.json({ actions: [action1] })),
      http.delete(`/api/notes/${NOTE_ID}/actions/:actionId`, () =>
        new Promise<Response>((res) => {
          rejectDelete = () => res(new HttpResponse(null, { status: 500 }))
        })),
    )
    renderActions()
    await userEvent.click(await screen.findByTestId('delete-action-a-1'))
    await waitFor(() => expect(screen.queryByText('Book meeting')).not.toBeInTheDocument())
    await act(async () => { rejectDelete() })
    expect(await screen.findByText('Book meeting')).toBeInTheDocument()
  })

  it('editing an action saves the new text via PUT and shows it optimistically', async () => {
    let putBody: unknown
    server.use(
      http.get(`/api/notes/${NOTE_ID}/actions`, () => HttpResponse.json({ actions: [action1] })),
      http.put(`/api/notes/${NOTE_ID}/actions/:actionId`, async ({ request }) => {
        putBody = await request.json()
        return new HttpResponse(null, { status: 200 })
      }),
    )
    renderActions()
    await userEvent.click(await screen.findByTestId('action-description-a-1'))
    const input = await screen.findByTestId('edit-action-input-a-1')
    await userEvent.clear(input)
    await userEvent.type(input, 'Book the big room{Enter}')
    await waitFor(() => expect(putBody).toEqual({ description: 'Book the big room' }))
    expect(await screen.findByTestId('action-description-a-1')).toHaveTextContent('Book the big room')
  })

  it('keyboard: focusing the description and pressing Enter opens the editor', async () => {
    server.use(http.get(`/api/notes/${NOTE_ID}/actions`, () => HttpResponse.json({ actions: [action1] })))
    renderActions()
    const desc = await screen.findByRole('button', { name: /Edit "Book meeting"/i })
    desc.focus()
    await userEvent.keyboard('{Enter}')
    expect(await screen.findByTestId('edit-action-input-a-1')).toBeInTheDocument()
  })

  it('Escape cancels editing without calling PUT and keeps the original text', async () => {
    let putCalled = false
    server.use(
      http.get(`/api/notes/${NOTE_ID}/actions`, () => HttpResponse.json({ actions: [action1] })),
      http.put(`/api/notes/${NOTE_ID}/actions/:actionId`, () => { putCalled = true; return new HttpResponse(null, { status: 200 }) }),
    )
    renderActions()
    await userEvent.click(await screen.findByTestId('action-description-a-1'))
    await userEvent.type(await screen.findByTestId('edit-action-input-a-1'), ' extra{Escape}')
    expect(putCalled).toBe(false)
    expect(await screen.findByTestId('action-description-a-1')).toHaveTextContent('Book meeting')
  })

  it('clearing the text to empty does not call PUT', async () => {
    let putCalled = false
    server.use(
      http.get(`/api/notes/${NOTE_ID}/actions`, () => HttpResponse.json({ actions: [action1] })),
      http.put(`/api/notes/${NOTE_ID}/actions/:actionId`, () => { putCalled = true; return new HttpResponse(null, { status: 200 }) }),
    )
    renderActions()
    await userEvent.click(await screen.findByTestId('action-description-a-1'))
    const input = await screen.findByTestId('edit-action-input-a-1')
    await userEvent.clear(input)
    await userEvent.type(input, '{Enter}')
    expect(putCalled).toBe(false)
    expect(await screen.findByTestId('action-description-a-1')).toHaveTextContent('Book meeting')
  })

  it('edit reverts to the original text when the request fails', async () => {
    let rejectPut!: () => void
    server.use(
      http.get(`/api/notes/${NOTE_ID}/actions`, () => HttpResponse.json({ actions: [action1] })),
      http.put(`/api/notes/${NOTE_ID}/actions/:actionId`, () =>
        new Promise<Response>((res) => { rejectPut = () => res(new HttpResponse(null, { status: 500 })) })),
    )
    renderActions()
    await userEvent.click(await screen.findByTestId('action-description-a-1'))
    const input = await screen.findByTestId('edit-action-input-a-1')
    await userEvent.clear(input)
    await userEvent.type(input, 'New text{Enter}')
    expect(await screen.findByText('New text')).toBeInTheDocument()
    await act(async () => { rejectPut() })
    await waitFor(() => expect(screen.queryByText('New text')).not.toBeInTheDocument())
    expect(screen.getByText('Book meeting')).toBeInTheDocument()
  })

  it('completing an action in a note updates the home to-do list (cross-view)', async () => {
    let completed = false
    const todo = { itemId: 'a-1', type: 'action', noteId: NOTE_ID, description: 'Book meeting', noteTitle: 'Note', completedAt: null }
    server.use(
      http.get(`/api/notes/${NOTE_ID}/actions`, () => HttpResponse.json({ actions: [action1] })),
      http.get('/api/todos', () =>
        HttpResponse.json({ items: [completed ? { ...todo, completedAt: new Date().toISOString() } : todo] })),
      http.post(`/api/notes/${NOTE_ID}/actions/:actionId/complete`, () => {
        completed = true
        return new HttpResponse(null, { status: 200 })
      }),
    )
    // Both views share one QueryClient (single render) — completing in the note
    // must invalidate keys.todos so the home list re-reads.
    render(<><TodoSection /><ActionsSection noteId={NOTE_ID} /></>)
    const todoList = await screen.findByTestId('todo-list')
    expect(todoList).toHaveTextContent('Book meeting')
    // Complete from the note's Actions section (distinct aria-label from the todo row)
    await userEvent.click(await screen.findByRole('checkbox', { name: /Mark "Book meeting" complete/i }))
    // The home list drops it from the open view once keys.todos refetches the
    // completed state (it moves to the collapsed Done section, not in the DOM).
    await waitFor(() =>
      expect(within(screen.getByTestId('todo-section')).queryByText('Book meeting')).not.toBeInTheDocument())
  })
})
