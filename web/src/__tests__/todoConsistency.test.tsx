import { http, HttpResponse } from 'msw'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { clearPendingTodoToken } from '../api/consistencyTokens'
import { addTodo, getTodos } from '../api/todos'
import { server } from '../test/setup'

// The pending-token store is module-global; clear it so a token captured in one test
// never leaks into the next (mirrors the workspace-store reset in setup.ts).
afterEach(() => clearPendingTodoToken())

describe('todos read-your-writes (RYW-1)', () => {
  it('GET /todos after POST /todos carries If-Consistent-With with the returned token', async () => {
    let sentToken: string | null = null
    server.use(
      http.post('/api/todos', () =>
        HttpResponse.json({ todoId: 'new-id', consistencyToken: 'todo#new-id@7' })),
      http.get('/api/todos', ({ request }) => {
        sentToken = request.headers.get('If-Consistent-With')
        return HttpResponse.json({ items: [] })
      }),
    )

    const result = await addTodo('Buy milk')
    expect(result.consistencyToken).toBe('todo#new-id@7')

    await getTodos()
    expect(sentToken).toBe('todo#new-id@7')
  })

  it('a stale GET /todos triggers a bounded retry (>=2 fetches) then resolves', async () => {
    vi.useFakeTimers()
    try {
      let gets = 0
      server.use(
        http.post('/api/todos', () =>
          HttpResponse.json({ todoId: 'id-2', consistencyToken: 'todo#id-2@3' })),
        http.get('/api/todos', () => {
          gets++
          // First response is stale; the second has caught up.
          if (gets === 1) {
            return HttpResponse.json({ items: [] }, { headers: { 'X-Consistency': 'stale' } })
          }
          return HttpResponse.json({
            items: [{ itemId: 'id-2', type: 'todo', noteId: null, noteTitle: null, description: 'Buy milk', addedAt: '2026-01-01T00:00:00Z', completedAt: null }],
          })
        }),
      )

      await addTodo('Buy milk')
      const promise = getTodos()
      await vi.runAllTimersAsync()
      const data = await promise

      expect(gets).toBeGreaterThanOrEqual(2)
      expect(data.items).toHaveLength(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('returns the current list after exhausting retries when still stale', async () => {
    vi.useFakeTimers()
    try {
      let gets = 0
      server.use(
        http.post('/api/todos', () =>
          HttpResponse.json({ todoId: 'id-3', consistencyToken: 'todo#id-3@1' })),
        http.get('/api/todos', () => {
          gets++
          return HttpResponse.json({ items: [] }, { headers: { 'X-Consistency': 'stale' } })
        }),
      )

      await addTodo('Slow task')
      const promise = getTodos()
      await vi.runAllTimersAsync()
      const data = await promise

      // 1 initial + 2 bounded retries.
      expect(gets).toBe(3)
      expect(data.items).toEqual([])
    } finally {
      vi.useRealTimers()
    }
  })
})
