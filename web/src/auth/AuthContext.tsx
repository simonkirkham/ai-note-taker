import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { AuthContext } from './context'
import { buildAuthUrl, exchangeCode, generateCodeChallenge, generateCodeVerifier } from './pkce'
import { attemptSilentRefresh } from './silentRefresh'
import { clearToken, loadPersistedToken, setToken, setOnForbidden, setOnRefresh, setOnUnauthorized } from './tokenStore'
import { getExp, REFRESH_LEAD_MS, useGoogleAuth } from './useGoogleAuth'

export function AuthProvider({
  children,
  initialToken,
}: {
  children: ReactNode
  initialToken?: string
}) {
  // When no client ID is configured (unset GitHub secret resolves to ""), bypass the sign-in
  // gate so local dev and E2E tests work without real Google credentials.
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? ''
  const persisted = !initialToken && clientId ? loadPersistedToken() : null
  // Seed the in-memory token synchronously, in the lazy initialiser, so it is set before any
  // child data-fetch effect runs (child effects run before parent effects). Otherwise the
  // first fetches go out with no Authorization header, get 401, and leave a blank screen.
  // The initialiser runs once on mount, so it never re-seeds after sign-out.
  const [idToken, setIdToken] = useState<string | null>(() => {
    const initial = initialToken ?? persisted ?? (clientId ? null : 'no-auth')
    if (initial && initial !== 'no-auth') setToken(initial)
    return initial
  })
  const [forbidden, setForbidden] = useState(false)
  const [sessionExpired, setSessionExpired] = useState(false)
  const mounted = useRef(false)
  // Forward ref so handleRefreshFailure can call cancelRefresh without a circular dep:
  // handleRefreshFailure is declared before useGoogleAuth returns cancelRefresh.
  const cancelRefreshRef = useRef<() => void>(() => {})

  const handleRefreshSuccess = useCallback((token: string) => {
    setToken(token)
    setIdToken(token)
    setSessionExpired(false)
  }, [])

  const handleRefreshFailure = useCallback(() => {
    cancelRefreshRef.current()
    clearToken()
    setIdToken(null)
    setSessionExpired(true)
  }, [])

  const { scheduleRefresh, cancelRefresh } = useGoogleAuth({
    onRefreshSuccess: handleRefreshSuccess,
    onRefreshFailure: handleRefreshFailure,
  })

  // cancelRefresh is a stable useCallback (no deps), but we populate the ref after
  // useGoogleAuth so handleRefreshFailure can call it without a circular initialisation.
  useEffect(() => { cancelRefreshRef.current = cancelRefresh }, [cancelRefresh])

  useEffect(() => {
    setOnForbidden(() => {
      clearToken()
      setForbidden(true)
    })
    setOnUnauthorized(() => {
      clearToken()
      setIdToken(null)
      cancelRefresh()
      setSessionExpired(true)
    })
    // A 401 from the API layer asks for a one-shot silent refresh; on success the new token
    // is adopted into React state, on failure api.ts falls back to triggerUnauthorized.
    setOnRefresh(async () => {
      if (!clientId) return null
      const newToken = await attemptSilentRefresh().catch(() => null)
      if (newToken) {
        handleRefreshSuccess(newToken)
        return newToken
      }
      return null
    })
  }, [cancelRefresh, clientId, handleRefreshSuccess])

  // Schedule token refresh whenever a real token is loaded or replaced
  useEffect(() => {
    if (!idToken || !clientId || idToken === 'no-auth') return
    const exp = getExp(idToken)
    if (exp) scheduleRefresh(exp)
  }, [idToken, clientId, scheduleRefresh])

  // Recheck token when the tab becomes visible — the refresh timer may have been
  // throttled while the tab was backgrounded, leaving an expired token in memory.
  useEffect(() => {
    if (!clientId || !idToken || idToken === 'no-auth') return

    function onVisibilityChange() {
      if (document.visibilityState !== 'visible') return
      const exp = getExp(idToken!) // safe: effect guard above ensures idToken is a non-null string
      if (!exp) return
      const remaining = exp * 1000 - Date.now()
      if (remaining <= 0) {
        handleRefreshFailure()
      } else if (remaining < REFRESH_LEAD_MS) {
        attemptSilentRefresh().then(newToken => {
          if (newToken) handleRefreshSuccess(newToken)
          else handleRefreshFailure()
        }).catch(() => handleRefreshFailure())
      }
    }

    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => document.removeEventListener('visibilitychange', onVisibilityChange)
  }, [clientId, idToken, handleRefreshSuccess, handleRefreshFailure])

  useEffect(() => {
    if (mounted.current) return
    mounted.current = true

    // Token already seeded synchronously in the useState initialiser; just skip OAuth exchange.
    if (initialToken) return

    if (!clientId) return

    const params = new URLSearchParams(window.location.search)
    const code = params.get('code')
    const returnedState = params.get('state')
    const verifier = sessionStorage.getItem('pkce_code_verifier')
    const storedState = sessionStorage.getItem('pkce_state')

    if (!code || !verifier || !returnedState || returnedState !== storedState) return

    sessionStorage.removeItem('pkce_code_verifier')
    sessionStorage.removeItem('pkce_state')
    window.history.replaceState({}, '', window.location.pathname)

    exchangeCode(window.location.origin, code, verifier)
      .then(({ id_token }) => {
        setToken(id_token)
        setIdToken(id_token)
      })
      .catch(() => { setIdToken(null) })
    // The mounted ref makes this a one-shot mount effect; clientId/initialToken are
    // listed to satisfy exhaustive-deps but are stable for the provider's lifetime.
  }, [clientId, initialToken])

  async function signIn() {
    if (!clientId) return
    const verifier = generateCodeVerifier()
    const challenge = await generateCodeChallenge(verifier)
    const state = generateCodeVerifier()
    sessionStorage.setItem('pkce_code_verifier', verifier)
    sessionStorage.setItem('pkce_state', state)
    window.location.href = buildAuthUrl(clientId, window.location.origin, challenge, state)
  }

  function signOut() {
    clearToken()
    cancelRefresh()
    setForbidden(false)
    setSessionExpired(false)
    setIdToken(clientId ? null : 'no-auth')
  }

  return (
    <AuthContext.Provider value={{ idToken, forbidden, sessionExpired, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}
