import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import type { ReactNode } from 'react'
import type { ActionItem } from '../api/actions'
import type { NoteCard } from '../api/notes'
import { keys } from '../api/queryKeys'
import type { TodoItem } from '../api/todos'
import {
  useAddAction,
  useCompleteAction,
  useDeleteAction,
  useReopenAction,
} from '../hooks/useActionMutations'
import { server } from '../test/setup'

// 27-C2: add-action swaps the optimistic temp id for the returned server id via
// setQueryData (no invalidate of the lagging actions projection), and the action
// shows up in the home to-do list (keys.todos) via an optimistic patch, not a refetch.

function setup(opts: { actions?: ActionItem[]; todos?: TodoItem[]; cards?: NoteCard[] } = {}) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  if (opts.actions) qc.setQueryData(keys.actions('n-1'), opts.actions)
  if (opts.todos) qc.setQueryData(keys.todos, opts.todos)
  if (opts.cards) qc.setQueryData(keys.noteCards, opts.cards)
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  )
  return { qc, wrapper }
}

const actions = (qc: QueryClient) => qc.getQueryData<ActionItem[]>(keys.actions('n-1')) ?? []
const todos = (qc: QueryClient) => qc.getQueryData<TodoItem[]>(keys.todos) ?? []
const cardActionIds = (qc: QueryClient) =>
  (qc.getQueryData<NoteCard[]>(keys.noteCards) ?? [])
    .find((c) => c.noteId === 'n-1')?.openActions.map((a) => a.actionId) ?? []

function cardWithActions(open: { actionId: string; description: string }[]): NoteCard {
  return {
    noteId: 'n-1', title: 'Sync', contentPreview: '', date: '2026-01-01',
    openActions: open, createdAt: '2026-01-01T00:00:00Z', lastModifiedAt: '2026-01-01T00:00:00Z',
    tags: [], folderId: null,
  }
}

describe('useAddAction (27-C2)', () => {
  it('swaps the optimistic temp id for the server id without invalidating keys.actions', async () => {
    server.use(http.post('/api/notes/n-1/actions', () =>
      HttpResponse.json({ actionId: 'srv-1' }, { status: 201 })))
    const { qc, wrapper } = setup({ actions: [], todos: [] })
    const spy = vi.spyOn(qc, 'invalidateQueries')
    const { result } = renderHook(() => useAddAction('n-1'), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({ description: 'Book room', tempId: 'temp-1' })
    })

    expect(actions(qc).map((a) => a.actionId)).toEqual(['srv-1'])
    expect(todos(qc).map((t) => t.itemId)).toEqual(['srv-1'])
    expect(spy).not.toHaveBeenCalledWith({ queryKey: keys.actions('n-1') })
    expect(spy).not.toHaveBeenCalledWith({ queryKey: keys.todos })
  })

  it('optimistically adds the action to the home to-do list and rolls back on failure', async () => {
    let reject!: () => void
    server.use(http.post('/api/notes/n-1/actions', () =>
      new Promise<Response>((res) => {
        reject = () => res(new HttpResponse(null, { status: 500 }) as unknown as Response)
      })))
    const { qc, wrapper } = setup({ actions: [], todos: [] })
    const { result } = renderHook(() => useAddAction('n-1'), { wrapper })

    act(() => { result.current.mutate({ description: 'Book room', tempId: 'temp-1' }) })
    await waitFor(() => expect(todos(qc).map((t) => t.description)).toEqual(['Book room']))
    await waitFor(() => expect(todos(qc)[0].type).toBe('action'))

    await act(async () => { reject() })
    await waitFor(() => expect(todos(qc)).toEqual([]))
    await waitFor(() => expect(actions(qc)).toEqual([]))
  })
})

describe('useCompleteAction (27-C2)', () => {
  it('marks the matching to-do completed optimistically without an invalidate', async () => {
    const existingTodo: TodoItem = {
      itemId: 'srv-1', type: 'action', noteId: 'n-1', noteTitle: 'Sync',
      description: 'Book room', addedAt: '2026-01-01T00:00:00Z', completedAt: null,
    }
    server.use(http.post('/api/notes/n-1/actions/srv-1/complete', () =>
      new HttpResponse(null, { status: 204 })))
    const { qc, wrapper } = setup({
      actions: [{ actionId: 'srv-1', description: 'Book room', completed: false, addedAt: '2026-01-01T00:00:00Z', completedAt: null }],
      todos: [existingTodo],
    })
    const spy = vi.spyOn(qc, 'invalidateQueries')
    const { result } = renderHook(() => useCompleteAction('n-1'), { wrapper })

    await act(async () => { await result.current.mutateAsync('srv-1') })

    expect(todos(qc)[0].completedAt).not.toBeNull()
    expect(spy).not.toHaveBeenCalledWith({ queryKey: keys.todos })
  })
})

describe('useReopenAction (27-C2)', () => {
  it("re-adds the reopened action to the card's open-actions list", async () => {
    server.use(http.post('/api/notes/n-1/actions/srv-1/reopen', () =>
      new HttpResponse(null, { status: 204 })))
    const { qc, wrapper } = setup({
      actions: [{ actionId: 'srv-1', description: 'Book room', completed: true, addedAt: '2026-01-01T00:00:00Z', completedAt: '2026-01-02T00:00:00Z' }],
      cards: [cardWithActions([])],
    })
    const { result } = renderHook(() => useReopenAction('n-1'), { wrapper })

    await act(async () => { await result.current.mutateAsync('srv-1') })

    expect(cardActionIds(qc)).toEqual(['srv-1'])
  })
})

describe('useDeleteAction (27-C2)', () => {
  it("removes the deleted action from the card's open-actions list", async () => {
    server.use(http.delete('/api/notes/n-1/actions/srv-1', () =>
      new HttpResponse(null, { status: 204 })))
    const { qc, wrapper } = setup({
      actions: [{ actionId: 'srv-1', description: 'Book room', completed: false, addedAt: '2026-01-01T00:00:00Z', completedAt: null }],
      cards: [cardWithActions([{ actionId: 'srv-1', description: 'Book room' }])],
    })
    const { result } = renderHook(() => useDeleteAction('n-1'), { wrapper })

    await act(async () => { await result.current.mutateAsync('srv-1') })

    expect(cardActionIds(qc)).toEqual([])
  })
})
