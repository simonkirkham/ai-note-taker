import { http, HttpResponse } from 'msw'
import { backoffMs, parseRetryAfter, retryConfig } from '../api/client'
import { createNote } from '../api/notes'
import { getTags } from '../api/tags'
import { getTodos } from '../api/todos'
import { clearToken, setToken, setOnRefresh, setOnUnauthorized } from '../auth/tokenStore'
import { server } from '../test/setup'

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
    expect(todos.items).toEqual([])
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

describe('apiFetch transient retry (19-H)', () => {
  // Zero the backoff so retries are instant; restore the real config afterwards.
  const originalBase = retryConfig.baseDelayMs
  beforeEach(() => { retryConfig.baseDelayMs = 0 })
  afterEach(() => { retryConfig.baseDelayMs = originalBase })

  it('retries an idempotent GET after a 503 and resolves on the retry', async () => {
    let call = 0
    server.use(
      http.get('/api/todos', () => {
        call++
        return call === 1 ? new HttpResponse(null, { status: 503 }) : HttpResponse.json({ items: [] })
      }),
    )
    expect((await getTodos()).items).toEqual([])
    expect(call).toBe(2)
  })

  it('retries an idempotent GET after a 429 (honouring Retry-After) and resolves', async () => {
    let call = 0
    server.use(
      http.get('/api/todos', () => {
        call++
        return call === 1
          ? new HttpResponse(null, { status: 429, headers: { 'Retry-After': '0' } })
          : HttpResponse.json({ items: [] })
      }),
    )
    expect((await getTodos()).items).toEqual([])
    expect(call).toBe(2)
  })

  it('retries an idempotent GET after a network error (TypeError)', async () => {
    let call = 0
    server.use(
      http.get('/api/todos', () => {
        call++
        return call === 1 ? HttpResponse.error() : HttpResponse.json({ items: [] })
      }),
    )
    expect((await getTodos()).items).toEqual([])
    expect(call).toBe(2)
  })

  it('never retries a POST creator on a 503 (no duplicate create)', async () => {
    let call = 0
    server.use(
      http.post('/api/notes', () => {
        call++
        return new HttpResponse(null, { status: 503 })
      }),
    )
    await expect(createNote()).rejects.toThrow()
    expect(call).toBe(1)
  })

  it('bounds retries at the attempt cap and surfaces the failure', async () => {
    let call = 0
    server.use(
      http.get('/api/todos', () => {
        call++
        return new HttpResponse(null, { status: 503 })
      }),
    )
    await expect(getTodos()).rejects.toThrow()
    expect(call).toBe(retryConfig.maxAttempts)
  })

  it('does not treat a 401 as transient (single call, routes to auth)', async () => {
    clearToken()
    const onUnauthorized = vi.fn()
    setOnUnauthorized(onUnauthorized)
    setOnRefresh(async () => null)
    let call = 0
    server.use(
      http.get('/api/todos', () => {
        call++
        return new HttpResponse(null, { status: 401 })
      }),
    )
    await expect(getTodos()).rejects.toThrow()
    expect(call).toBe(1)
    expect(onUnauthorized).toHaveBeenCalledTimes(1)
  })
})

describe('retry helpers', () => {
  it('parseRetryAfter reads whole seconds into ms, and null when absent/unparseable', () => {
    expect(parseRetryAfter('2')).toBe(2000)
    expect(parseRetryAfter('0')).toBe(0)
    expect(parseRetryAfter(null)).toBeNull()
    expect(parseRetryAfter('not-a-number')).toBeNull()
  })

  it('backoffMs grows exponentially within a jittered band', () => {
    const original = { ...retryConfig }
    try {
      retryConfig.baseDelayMs = 100
      retryConfig.maxDelayMs = 4000
      // attempt 1: base 100, full jitter → [100, 200); attempt 2: base 200 → [200, 400)
      const d1 = backoffMs(1)
      const d2 = backoffMs(2)
      expect(d1).toBeGreaterThanOrEqual(100)
      expect(d1).toBeLessThan(200)
      expect(d2).toBeGreaterThanOrEqual(200)
      expect(d2).toBeLessThan(400)
    } finally {
      Object.assign(retryConfig, original)
    }
  })
})
