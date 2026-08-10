import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthProvider } from '../auth/AuthContext'
import { useAuth } from '../auth/context'
import { startCalendarConnect } from '../auth/pkce'
import { installChunkReloadHandler } from '../lib/chunkReload'
import { hardRedirect } from '../lib/hardRedirect'

// BUG-60, the half that mattered. Attempt 1 guarded the storage calls and stopped there, which made
// sign-in WORSE than the crash it fixed: the throw had at least prevented `window.location.href`
// being reached (the button looked dead), whereas a swallowed write let the redirect fire, so the
// OAuth return found no verifier, bailed before `replaceState`, and left the user on the sign-in
// page holding a spent `?code=` — an unbounded silent loop, for exactly the users the fix serves.
//
// So these tests assert the NON-EVENT: no redirect. That is only observable because the redirect
// goes through `lib/hardRedirect` — jsdom refuses to let `window.location` be stubbed or redefined.

vi.mock('../lib/hardRedirect', () => ({ hardRedirect: vi.fn() }))

const redirected = vi.mocked(hardRedirect)

function refuseStorage() {
  const spies = [
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError')
    }),
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('SecurityError')
    }),
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new DOMException('SecurityError')
    }),
  ]
  return () => spies.forEach((s) => s.mockRestore())
}

// Storage that silently discards writes without throwing — Safari's private mode did exactly this
// for years. `setItem` not throwing is NOT evidence the value is there, which is why the guard
// reads back rather than relying on the absence of an exception.
function silentlyDiscardWrites() {
  const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {})
  const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => null)
  return () => {
    setItem.mockRestore()
    getItem.mockRestore()
  }
}

beforeEach(() => {
  vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'test-client-id')
  redirected.mockClear()
  window.history.replaceState({}, '', '/')
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

function SignInProbe() {
  const { signIn, storageBlocked } = useAuth()
  return (
    <div>
      <button type="button" onClick={() => void signIn()}>
        Sign in
      </button>
      <span data-testid="blocked">{storageBlocked ? 'blocked' : 'ok'}</span>
    </div>
  )
}

describe('sign-in against a storage-refusing browser (BUG-60)', () => {
  it('does not start the OAuth redirect when the PKCE verifier cannot be stored', async () => {
    const restore = refuseStorage()
    try {
      render(
        <AuthProvider>
          <SignInProbe />
        </AuthProvider>,
      )
      await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
      await waitFor(() => expect(screen.getByTestId('blocked')).toHaveTextContent('blocked'))
      expect(redirected).not.toHaveBeenCalled()
    } finally {
      restore()
    }
  })

  it('does not redirect when the write is silently discarded rather than throwing', async () => {
    const restore = silentlyDiscardWrites()
    try {
      render(
        <AuthProvider>
          <SignInProbe />
        </AuthProvider>,
      )
      await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
      await waitFor(() => expect(screen.getByTestId('blocked')).toHaveTextContent('blocked'))
      expect(redirected).not.toHaveBeenCalled()
    } finally {
      restore()
    }
  })

  it('still redirects normally when storage works', async () => {
    render(
      <AuthProvider>
        <SignInProbe />
      </AuthProvider>,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    await waitFor(() => expect(redirected).toHaveBeenCalledTimes(1))
    expect(redirected.mock.calls[0][0]).toContain('accounts.google.com')
    expect(screen.getByTestId('blocked')).toHaveTextContent('ok')
    expect(sessionStorage.getItem('pkce_code_verifier')).not.toBeNull()
  })
})

describe('an OAuth return with no stored verifier (BUG-60)', () => {
  it('strips the spent code from the URL instead of leaving it to be replayed', async () => {
    window.history.replaceState({}, '', '/?code=spent-code&state=xyz')

    render(
      <AuthProvider>
        <SignInProbe />
      </AuthProvider>,
    )

    await waitFor(() => expect(window.location.search).toBe(''))
    expect(screen.getByTestId('blocked')).toHaveTextContent('blocked')
  })
})

describe('calendar connect against a storage-refusing browser (BUG-60)', () => {
  it('reports failure and does not redirect when the verifier cannot be stored', async () => {
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'test-client-id')
    const restore = refuseStorage()
    try {
      const started = await startCalendarConnect('google')

      // Not a bare false: the caller must be able to tell a refused write apart from the dev/E2E
      // "no client id configured" no-op, because only one of them is worth telling the user about.
      expect(started).toBe('storage-blocked')
      expect(redirected).not.toHaveBeenCalled()
    } finally {
      restore()
    }
  })

  it('redirects as normal when storage works', async () => {
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'test-client-id')

    const started = await startCalendarConnect('google')

    expect(started).toBe('redirecting')
    expect(redirected).toHaveBeenCalledTimes(1)
  })
})

// Review of attempt 1: the spec stubbed `Storage.prototype` METHODS, so `store()`'s guard — which
// exists for browsers that throw on the `sessionStorage` PROPERTY ACCESS itself (a blocked
// third-party context is the usual cause) — was never exercised and could be deleted with the suite
// green. Stub the property, not the methods.
describe('a browser that throws on the storage property itself (BUG-60)', () => {
  function refusePropertyAccess() {
    const original = Object.getOwnPropertyDescriptor(window, 'sessionStorage')
    Object.defineProperty(window, 'sessionStorage', {
      configurable: true,
      get() {
        throw new DOMException('SecurityError')
      },
    })
    return () => {
      if (original) Object.defineProperty(window, 'sessionStorage', original)
    }
  }

  it('reads null and refuses the sign-in redirect rather than throwing', async () => {
    const restore = refusePropertyAccess()
    try {
      const { safeSession } = await import('../lib/safeStorage')
      expect(safeSession.get('anything')).toBeNull()
      expect(() => safeSession.set('k', 'v')).not.toThrow()
      expect(safeSession.verifiedSet('k', 'v')).toBe(false)
    } finally {
      restore()
    }
  })
})

describe('chunk-reload self-heal against a storage-refusing browser (BUG-60)', () => {
  function fakeWindow(storage: Partial<Storage>) {
    const listeners: ((e: Event) => void)[] = []
    const reload = vi.fn()
    return {
      win: {
        addEventListener: (_type: string, fn: (e: Event) => void) => listeners.push(fn),
        sessionStorage: storage as Storage,
        location: { reload },
      } as unknown as Window,
      fire: () => listeners.forEach((fn) => fn({ preventDefault: () => {} } as Event)),
      reload,
    }
  }

  it('does not reload when the guard flag cannot be persisted', () => {
    // The flag is the ONLY thing bounding this to one reload. Without it, reloading would hit the
    // same failed chunk, find no flag, and reload again — forever. Falling through to the
    // ErrorBoundary costs the self-heal; looping costs the user the app entirely.
    const { win, fire, reload } = fakeWindow({
      getItem: () => {
        throw new DOMException('SecurityError')
      },
      setItem: () => {
        throw new DOMException('QuotaExceededError')
      },
    })

    installChunkReloadHandler(win)
    fire()

    expect(reload).not.toHaveBeenCalled()
  })

  it('reloads once when storage works', () => {
    const store = new Map<string, string>()
    const { win, fire, reload } = fakeWindow({
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    })

    installChunkReloadHandler(win)
    fire()
    fire()

    expect(reload).toHaveBeenCalledTimes(1)
  })
})
