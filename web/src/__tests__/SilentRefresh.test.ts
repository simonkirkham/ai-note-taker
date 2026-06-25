import { describe, it, expect, vi, afterEach } from 'vitest'
import { attemptSilentRefresh } from '../auth/silentRefresh'

describe('attemptSilentRefresh', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('POSTs to /api/auth/refresh with credentials and returns the new id_token', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id_token: 'new-token' }) })
    vi.stubGlobal('fetch', fetchMock)

    const token = await attemptSilentRefresh()

    expect(fetchMock).toHaveBeenCalledWith('/api/auth/refresh', expect.objectContaining({ method: 'POST', credentials: 'include' }))
    expect(token).toBe('new-token')
  })

  it('returns null when the refresh endpoint responds non-ok (session over)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }))
    expect(await attemptSilentRefresh()).toBeNull()
  })

  it('returns null when the response carries no id_token', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }))
    expect(await attemptSilentRefresh()).toBeNull()
  })

  it('returns null when fetch rejects', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')))
    expect(await attemptSilentRefresh()).toBeNull()
  })
})
