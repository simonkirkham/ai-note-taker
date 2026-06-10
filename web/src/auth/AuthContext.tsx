import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { AuthContext, type AuthState } from './context'
import { buildAuthUrl, exchangeCode, generateCodeChallenge, generateCodeVerifier } from './pkce'
import { attemptSilentRefresh } from './silentRefresh'
import { clearRefreshEstablished, clearToken, isRefreshEstablished, loadPersistedToken, markRefreshEstablished, setToken, setOnForbidden, setOnRefresh, setOnUnauthorized } from './tokenStore'
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
  // Cold start with no usable in-memory token: the access token has lapsed but the httpOnly
  // refresh cookie may still mint a fresh one. Attempt a silent refresh before falling back to
  // sign-in, so the session lasts the cookie's lifetime (~30 days), not ~1 hour (BUG-15).
  // Skipped when returning from an OAuth redirect (a `code` is present — the exchange effect
  // below handles that) and in no-auth/dev mode (no clientId).
  const hasOAuthCode = clientId !== '' && typeof window !== 'undefined'
    && new URLSearchParams(window.location.search).has('code')
  const shouldBootstrapRefresh = clientId !== '' && !initialToken && !persisted && !hasOAuthCode
  const [authLoading, setAuthLoading] = useState(shouldBootstrapRefresh)
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
    // A working refresh proves a refresh token is on file → returning sign-ins can skip the
    // consent prompt (and its email) (BUG-16).
    markRefreshEstablished()
  }, [])

  const handleRefreshFailure = useCallback(() => {
    cancelRefreshRef.current()
    clearToken()
    setIdToken(null)
    setSessionExpired(true)
    // The refresh token is gone/invalid → the next sign-in must re-consent to obtain a new one.
    clearRefreshEstablished()
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
        // A completed interactive sign-in establishes the session; record that a refresh token
        // is on file so subsequent sign-ins can skip the consent prompt (BUG-16).
        markRefreshEstablished()
      })
      .catch(() => { setIdToken(null) })
    // The mounted ref makes this a one-shot mount effect; clientId/initialToken are
    // listed to satisfy exhaustive-deps but are stable for the provider's lifetime.
  }, [clientId, initialToken])

  // One-shot cold-start refresh: mint a fresh token from the refresh cookie before the gate
  // decides to show sign-in. authLoading keeps the gate in a loading state while in flight, so
  // the sign-in screen never flashes for a user whose cookie is still valid (BUG-15). idToken
  // stays null until the token arrives, so AppContent (and its child fetches) is not rendered
  // mid-flight — preserving the BUG-1 "token set before first fetch" invariant.
  useEffect(() => {
    if (!shouldBootstrapRefresh) return
    let cancelled = false
    attemptSilentRefresh()
      .then((token) => {
        if (cancelled) return
        if (token) handleRefreshSuccess(token)
        // No token: the refresh cookie is gone/invalid, so the upcoming sign-in must re-consent
        // to obtain a new refresh token (BUG-16). handleRefreshSuccess marks it on success.
        else clearRefreshEstablished()
      })
      .catch(() => { if (!cancelled) clearRefreshEstablished() })
      .finally(() => { if (!cancelled) setAuthLoading(false) })
    return () => { cancelled = true }
    // Run once on mount; shouldBootstrapRefresh/handleRefreshSuccess are stable for the
    // provider's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const signIn = useCallback(async () => {
    if (!clientId) return
    const verifier = generateCodeVerifier()
    const challenge = await generateCodeChallenge(verifier)
    const state = generateCodeVerifier()
    sessionStorage.setItem('pkce_code_verifier', verifier)
    sessionStorage.setItem('pkce_state', state)
    // OAuth redirects back to the origin root, so stash the requested deep-link
    // and let the gate restore it once authed (21-C).
    const dest = window.location.pathname + window.location.search
    if (dest !== '/') sessionStorage.setItem('postLoginRedirect', dest)
    // Force the consent prompt only when no refresh token is on file — a returning user
    // re-authenticates silently, with no fresh consent grant and no Google email (BUG-16).
    window.location.href = buildAuthUrl(clientId, window.location.origin, challenge, state, !isRefreshEstablished())
  }, [clientId])

  const signOut = useCallback(() => {
    clearToken()
    cancelRefresh()
    setForbidden(false)
    setSessionExpired(false)
    setIdToken(clientId ? null : 'no-auth')
  }, [clientId, cancelRefresh])

  const value = useMemo<AuthState>(
    () => ({ idToken, forbidden, sessionExpired, authLoading, signIn, signOut }),
    [idToken, forbidden, sessionExpired, authLoading, signIn, signOut],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
