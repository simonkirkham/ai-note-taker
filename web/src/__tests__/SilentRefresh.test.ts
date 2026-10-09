import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { attemptSilentRefresh } from '../auth/silentRefresh'

const ok = (token: string) => ({ ok: true, status: 200, json: async () => ({ id_token: token }) })
const status = (code: number) => ({ ok: false, status: code, json: async () => ({}) })

describe('attemptSilentRefresh', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('POSTs to /api/auth/refresh with credentials and returns the new id_token', async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok('new-token'))
    vi.stubGlobal('fetch', fetchMock)

    const token = await attemptSilentRefresh()

    expect(fetchMock).toHaveBeenCalledWith('/api/auth/refresh', expect.objectContaining({ method: 'POST', credentials: 'include' }))
    expect(token).toBe('new-token')
  })

  it('returns null at once when the server refuses the session', async () => {
    const fetchMock = vi.fn().mockResolvedValue(status(401))
    vi.stubGlobal('fetch', fetchMock)

    expect(await attemptSilentRefresh()).toBeNull()
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('returns null when the response carries no id_token', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) }))
    expect(await attemptSilentRefresh()).toBeNull()
  })
})

// BUG-90: the computer wakes, the overdue refresh fires before the network is back, and the
// failure used to be read as "session over" — signing the user out of a valid 30-day session.
describe('attemptSilentRefresh when the network is not back yet (BUG-90)', () => {
  beforeEach(() => { vi.useFakeTimers() })

  it('Given the network drops the first attempt, When the next attempt reaches the server, Then the session is kept', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(ok('new-token'))
    vi.stubGlobal('fetch', fetchMock)

    const result = attemptSilentRefresh()
    await vi.advanceTimersByTimeAsync(5_000)

    expect(await result).toBe('new-token')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('Given the app cannot reach the server (desktop proxy answers 500), When it recovers, Then the session is kept', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(status(500))
      .mockResolvedValueOnce(status(502))
      .mockResolvedValueOnce(ok('new-token'))
    vi.stubGlobal('fetch', fetchMock)

    const result = attemptSilentRefresh()
    await vi.advanceTimersByTimeAsync(10_000)

    expect(await result).toBe('new-token')
  })

  it('Given the computer is offline, When it comes back online, Then the refresh is retried and the session kept', async () => {
    vi.stubGlobal('navigator', { onLine: false })
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(ok('new-token'))
    vi.stubGlobal('fetch', fetchMock)

    const result = attemptSilentRefresh()
    // Far longer than the retry budget: while offline the session is never given up.
    await vi.advanceTimersByTimeAsync(30 * 60_000)
    expect(fetchMock).toHaveBeenCalledOnce()

    vi.stubGlobal('navigator', { onLine: true })
    window.dispatchEvent(new Event('online'))
    await vi.advanceTimersByTimeAsync(0)

    expect(await result).toBe('new-token')
  })

  it('Given the server stays unreachable while online, When the retry budget runs out, Then it gives up', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    vi.stubGlobal('fetch', fetchMock)

    const result = attemptSilentRefresh()
    await vi.advanceTimersByTimeAsync(5 * 60_000)

    expect(await result).toBeNull()
    expect(fetchMock.mock.calls.length).toBeGreaterThan(3)
  })

  it('Given several parts of the app ask at once, When the network is down, Then only one refresh runs', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(ok('new-token'))
    vi.stubGlobal('fetch', fetchMock)

    const results = Promise.all([attemptSilentRefresh(), attemptSilentRefresh()])
    await vi.advanceTimersByTimeAsync(5_000)

    expect(await results).toEqual(['new-token', 'new-token'])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
