import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { connectGoogleCalendar, connectMicrosoftCalendar } from '../api/calendarAuth'
import { setWorkspaceId } from '../workspace/workspaceStore'
import { AuthContext, type AuthState } from './context'
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
  // Cold start with no usable in-memory token: the access token has lapsed but the httpOnly
  // refresh cookie may still mint a fresh one. Attempt a silent refresh before falling back to
  // sign-in, so the session lasts the cookie's lifetime (~30 days), not ~1 hour (BUG-15).
  // Skipped when returning from an OAuth redirect (a `code` is present — the exchange effect
  // below handles that) and in no-auth/dev mode (no clientId).
  const hasOAuthCode = clientId !== '' && typeof window !== 'undefined'
    && new URLSearchParams(window.location.search).has('code')
  const shouldBootstrapRefresh = clientId !== '' && !initialToken && !persisted && !hasOAuthCode
  // Returning from the in-app calendar consent (a `code` plus our calendar_state marker). Keep the
  // gate in a loading state while we restore the session and POST the connect, so the sign-in
  // screen never flashes mid-connect.
  const isCalendarConnectReturn = hasOAuthCode && typeof window !== 'undefined'
    && sessionStorage.getItem('calendar_state') != null
  const [authLoading, setAuthLoading] = useState(shouldBootstrapRefresh || isCalendarConnectReturn)
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
      // safe: effect guard above ensures idToken is a non-null string
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const exp = getExp(idToken!)
      if (!exp) return
      const remaining = exp * 1000 - Date.now()
      // Inside (or past) the refresh lead, always try the rt cookie first — an expired
      // in-memory token does not mean the session is over (the cookie lasts ~30 days). Only
      // sign out when the refresh itself fails (30-C / BUG-33).
      if (remaining < REFRESH_LEAD_MS) {
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

    // Calendar-connect return (34-A): a `code` with our calendar_state marker. Restore the session
    // (the redirect dropped the in-memory token) so the connect call is authenticated, POST the
    // code to the connect endpoint, THEN reveal the app — setting the token store before setIdToken
    // means the connection query doesn't fire (and read needs_auth) until the connect persisted.
    const calState = sessionStorage.getItem('calendar_state')
    const calVerifier = sessionStorage.getItem('calendar_verifier')
    if (code && returnedState && calState && returnedState === calState && calVerifier) {
      sessionStorage.removeItem('calendar_state')
      sessionStorage.removeItem('calendar_verifier')
      // 34-B: restore the workspace the connect was started from (the OAuth redirect dropped the
      // `/w/:wsId` path). Set the store BEFORE the connect POST so the api client scopes it to the
      // right workspace, and restore the URL so the app lands back in that workspace.
      const calWorkspace = sessionStorage.getItem('calendar_workspace')
      sessionStorage.removeItem('calendar_workspace')
      // 34-C: POST the code to the provider the connect was started for (Google or Outlook).
      const calProvider = sessionStorage.getItem('calendar_provider')
      sessionStorage.removeItem('calendar_provider')
      if (calWorkspace) setWorkspaceId(calWorkspace)
      window.history.replaceState({}, '', calWorkspace ? `/w/${calWorkspace}` : window.location.pathname)
      void (async () => {
        const token = await attemptSilentRefresh().catch(() => null)
        if (token) setToken(token)
        try {
          if (calProvider === 'microsoft') await connectMicrosoftCalendar(window.location.origin, code, calVerifier)
          else await connectGoogleCalendar(window.location.origin, code, calVerifier)
        } catch { /* a failed connect surfaces as needs_auth on the next connection read */ }
        if (token) setIdToken(token)
        setAuthLoading(false)
      })()
      return
    }

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
      })
      // Refresh failure needs no action — the gate falls through to the sign-in screen — but the
      // rejection must be handled so the chain isn't a floating promise (no-floating-promises).
      .catch(() => { /* cookie gone/invalid → show sign-in (handled by the null-token path) */ })
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
    // Never force consent: the first-ever authorization consents once (Google forces it on a
    // not-yet-granted scope), and every later sign-in re-authenticates silently. Lost tokens are
    // restored from the server-side store (30-A), not by re-consenting (30-B).
    window.location.href = buildAuthUrl(clientId, window.location.origin, challenge, state)
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
