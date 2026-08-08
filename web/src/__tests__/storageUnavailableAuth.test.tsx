import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getStreamToken, setStreamToken } from '../api/consistencyTokens'
import { AuthProvider } from '../auth/AuthContext'
import { useAuth } from '../auth/context'
import { safeLocal, safeSession } from '../lib/safeStorage'

// BUG-60: `sessionStorage`/`localStorage` access THROWS (rather than returning null) in private
// mode, a blocked third-party context, or at quota. Four sites in AuthContext were unguarded, and
// the calendar-return probe runs DURING RENDER — so on any OAuth return the whole tree came down.
// The correct degradation is losing a stashed deep-link/PKCE verifier, never a crash.

function throwOnStorage() {
  const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new DOMException('SecurityError')
  })
  const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new DOMException('QuotaExceededError')
  })
  const removeItem = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
    throw new DOMException('SecurityError')
  })
  return () => {
    getItem.mockRestore()
    setItem.mockRestore()
    removeItem.mockRestore()
  }
}

// The calendar-return probe that runs during render is behind `clientId !== ''`, so without a
// configured client id this whole suite would pass vacuously — it would never reach the throw.
beforeEach(() => vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'test-client-id'))
afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

function Probe() {
  const { idToken } = useAuth()
  return <div data-testid="probe">{idToken ?? 'none'}</div>
}

describe('storage-refusing browser (BUG-60)', () => {
  it('renders the auth tree on an OAuth return when storage throws', async () => {
    window.history.replaceState({}, '', '/?code=abc&state=xyz')
    const restore = throwOnStorage()
    try {
      render(
        <AuthProvider initialToken="seed-token">
          <Probe />
        </AuthProvider>,
      )
      await waitFor(() => expect(screen.getByTestId('probe')).toBeInTheDocument())
    } finally {
      restore()
    }
  })

  it('safe accessors degrade to null / no-op instead of throwing', () => {
    const restore = throwOnStorage()
    try {
      expect(safeSession.get('anything')).toBeNull()
      expect(safeLocal.get('anything')).toBeNull()
      expect(() => safeSession.set('k', 'v')).not.toThrow()
      expect(() => safeLocal.set('k', 'v')).not.toThrow()
      expect(() => safeSession.remove('k')).not.toThrow()
      expect(() => safeLocal.remove('k')).not.toThrow()
    } finally {
      restore()
    }
  })

  it('RYW token capture degrades to no token when storage throws', () => {
    const restore = throwOnStorage()
    try {
      expect(() => setStreamToken('note#n1', 'note#n1@3')).not.toThrow()
      expect(getStreamToken('note#n1')).toBeNull()
    } finally {
      restore()
    }
  })
})
