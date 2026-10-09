import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { abandonSilentRefresh, attemptSilentRefresh } from '../auth/silentRefresh'

const ok = (token: string) => ({ ok: true, status: 200, json: async () => ({ id_token: token }) })
const status = (code: number) => ({ ok: false, status: code, json: async () => ({}) })

describe('attemptSilentRefresh', () => {
  afterEach(() => {
    abandonSilentRefresh()
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
  // A failed test can leave its attempt pending; without this the next test is handed that attempt.
  afterEach(() => {
    abandonSilentRefresh()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

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

  it('Given the network comes back, When the browser says it is online, Then the refresh is retried at once instead of waiting out the backoff', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(ok('new-token'))
    vi.stubGlobal('fetch', fetchMock)

    const result = attemptSilentRefresh()
    await vi.advanceTimersByTimeAsync(7_100)
    expect(fetchMock).toHaveBeenCalledTimes(4)

    window.dispatchEvent(new Event('online'))
    await vi.advanceTimersByTimeAsync(0)

    // Count first: if the event were ignored, awaiting the result would hang the test instead of failing it.
    expect(fetchMock).toHaveBeenCalledTimes(5)
    expect(await result).toBe('new-token')
  })

  // Windows reports itself online throughout a reconnect when it has virtual network adapters,
  // so a budget measured while "online" would still sign the user out after a slow Wi-Fi/VPN return.
  it('Given the server stays unreachable for half an hour, When it finally answers, Then the session is kept', async () => {
    let reachable = false
    const fetchMock = vi.fn().mockImplementation(async () => {
      if (!reachable) throw new TypeError('Failed to fetch')
      return ok('new-token')
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = attemptSilentRefresh()
    await vi.advanceTimersByTimeAsync(30 * 60_000)
    reachable = true
    await vi.advanceTimersByTimeAsync(30_000)

    expect(await result).toBe('new-token')
  })

  it.each([503, 504])('Given the server answers %i (an outage, not a refusal), Then the refresh is retried', async (code) => {
    const fetchMock = vi.fn().mockResolvedValueOnce(status(code)).mockResolvedValueOnce(ok('new-token'))
    vi.stubGlobal('fetch', fetchMock)

    const result = attemptSilentRefresh()
    await vi.advanceTimersByTimeAsync(5_000)

    expect(await result).toBe('new-token')
  })

  it('Given the server refuses with a 4xx other than 401, Then it is not retried', async () => {
    const fetchMock = vi.fn().mockResolvedValue(status(403))
    vi.stubGlobal('fetch', fetchMock)

    const result = attemptSilentRefresh()
    await vi.advanceTimersByTimeAsync(60_000)

    expect(await result).toBeNull()
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('Given a reply that cannot be read, When the next reply is good, Then the session is kept', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => { throw new SyntaxError('cut off') } })
      .mockResolvedValueOnce(ok('new-token'))
    vi.stubGlobal('fetch', fetchMock)

    const result = attemptSilentRefresh()
    await vi.advanceTimersByTimeAsync(5_000)

    expect(await result).toBe('new-token')
  })

  it('Given a refresh is waiting for the network, When the user signs out, Then the late refresh does not sign them back in', async () => {
    let reachable = false
    const fetchMock = vi.fn().mockImplementation(async () => {
      if (!reachable) throw new TypeError('Failed to fetch')
      return ok('new-token')
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = attemptSilentRefresh()
    await vi.advanceTimersByTimeAsync(3_000)
    abandonSilentRefresh()
    reachable = true
    await vi.advanceTimersByTimeAsync(60_000)

    expect(await result).toBeNull()
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
