import { http, HttpResponse } from 'msw'
import { server } from '../test/setup'
import { getTodos, getTags } from '../api'
import { clearToken, setToken, setOnRefresh, setOnUnauthorized } from '../auth/tokenStore'

// apiFetch is exercised through the real exported API functions (getTodos, getTags),
// which call it under the hood. MSW intercepts the network; the token store callbacks
// (onRefresh / onUnauthorized) stand in for AuthContext.

beforeEach(() => {
  clearToken()
  setOnRefresh(async () => null)
  setOnUnauthorized(() => {})
})

afterEach(() => {
  clearToken()
  setOnRefresh(async () => null)
  setOnUnauthorized(() => {})
})

describe('apiFetch 401 handling', () => {
  it('routes to sign-in when a 401 is returned and no token was attached', async () => {
    // The core BUG-1 regression: a request goes out with no token (effect-ordering race),
    // the server returns 401, and the old `&& token` guard swallowed it → blank screen.
    clearToken() // getToken() === null
    const onUnauthorized = vi.fn()
    setOnUnauthorized(onUnauthorized)
    setOnRefresh(async () => null) // no session to refresh

    server.use(http.get('/api/todos', () => new HttpResponse(null, { status: 401 })))

    await expect(getTodos()).rejects.toThrow()
    expect(onUnauthorized).toHaveBeenCalledTimes(1)
  })

  it('retries once with the refreshed token after a 401', async () => {
    setToken('stale-token')
    setOnRefresh(async () => 'fresh-token')

    let call = 0
    let secondAuth: string | null = null
    server.use(
      http.get('/api/todos', ({ request }) => {
        call++
        if (call === 1) return new HttpResponse(null, { status: 401 })
        secondAuth = request.headers.get('authorization')
        return HttpResponse.json({ items: [] })
      }),
    )

    const todos = await getTodos()

    expect(call).toBe(2)
    expect(secondAuth).toBe('Bearer fresh-token')
    expect(todos).toEqual([])
  })

  it('deduplicates concurrent refreshes to a single refresh', async () => {
    setToken('stale-token')
    // A gated refresh that stays in flight until we release it — mirrors the real iframe
    // round-trip, so both concurrent 401s reach refreshOnce while the refresh is pending.
    let releaseRefresh!: (token: string | null) => void
    const refreshGate = new Promise<string | null>((resolve) => { releaseRefresh = resolve })
    const refresh = vi.fn(() => refreshGate)
    setOnRefresh(refresh)

    let todosCall = 0
    let tagsCall = 0
    server.use(
      http.get('/api/todos', () => {
        todosCall++
        return todosCall === 1 ? new HttpResponse(null, { status: 401 }) : HttpResponse.json({ items: [] })
      }),
      http.get('/api/tags', () => {
        tagsCall++
        return tagsCall === 1 ? new HttpResponse(null, { status: 401 }) : HttpResponse.json({ tags: [] })
      }),
    )

    const pending = Promise.all([getTodos(), getTags()])
    await new Promise((r) => setTimeout(r, 10)) // let both first fetches 401 and enter refreshOnce
    releaseRefresh('fresh-token')
    await pending

    expect(refresh).toHaveBeenCalledTimes(1)
    expect(todosCall).toBe(2)
    expect(tagsCall).toBe(2)
  })

  it('routes to sign-in when the retried request also returns 401', async () => {
    setToken('stale-token')
    setOnRefresh(async () => 'fresh-token')
    const onUnauthorized = vi.fn()
    setOnUnauthorized(onUnauthorized)

    server.use(http.get('/api/todos', () => new HttpResponse(null, { status: 401 })))

    await expect(getTodos()).rejects.toThrow()
    expect(onUnauthorized).toHaveBeenCalledTimes(1)
  })
})
