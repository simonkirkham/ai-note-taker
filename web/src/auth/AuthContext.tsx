import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { connectGoogleCalendar, connectMicrosoftCalendar } from '../api/calendarAuth'
import { clearDeletedNote } from '../lib/deletedNoteRescue'
import { hardRedirect } from '../lib/hardRedirect'
import { safeSession } from '../lib/safeStorage'
import { recordRumEvent } from '../rum'
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
  // BUG-71: match the returned `state` against the stored marker, not merely "a marker exists".
  // An ABANDONED calendar connect (started, never completed) leaves `calendar_state` in
  // sessionStorage indefinitely. A later ORDINARY sign-in return then satisfied this, seeded
  // `authLoading = true`, and took the sign-in exchange path — which never clears authLoading. The
  // gate sat on its loading state forever, recoverable only by clearing site data, which is exactly
  // what the affected user is least likely to try. The effect below already performs this same
  // comparison before acting on the branch; the derivation was simply weaker than the branch it
  // predicts, and predicting the wrong branch is what stranded the user.
  const isCalendarConnectReturn = hasOAuthCode && typeof window !== 'undefined'
    && safeSession.get('calendar_state') != null
    && new URLSearchParams(window.location.search).get('state') === safeSession.get('calendar_state')
  const [authLoading, setAuthLoading] = useState(shouldBootstrapRefresh || isCalendarConnectReturn)
  const [forbidden, setForbidden] = useState(false)
  const [sessionExpired, setSessionExpired] = useState(false)
  // BUG-60: an OAuth `code` came back but no verifier is stored, so the exchange is impossible and
  // the code is already spent. SEEDED ONCE at mount from a render-time probe — deliberately NOT
  // re-derived on every render. That distinction is load-bearing: the effect below strips `?code=`
  // from the URL, so a re-derived value would flip back to false on the next render and the message
  // would vanish. It is a probe rather than a setState in the effect because that trips
  // `react-hooks/set-state-in-effect`, which lint gates on (and tsc/vitest do not). The read is safe
  // during render precisely because safeSession swallows the throw — which is what this fix is for.
  // Not a calendar return, which carries its own verifier and state.
  const [storageBlocked, setStorageBlocked] = useState(() =>
    hasOAuthCode && !isCalendarConnectReturn && safeSession.get('pkce_code_verifier') == null)
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
    const calState = safeSession.get('calendar_state')
    const calVerifier = safeSession.get('calendar_verifier')
    if (code && returnedState && calState && returnedState === calState && calVerifier) {
      safeSession.remove('calendar_state')
      safeSession.remove('calendar_verifier')
      // 34-B: restore the workspace the connect was started from (the OAuth redirect dropped the
      // `/w/:wsId` path). Set the store BEFORE the connect POST so the api client scopes it to the
      // right workspace, and restore the URL so the app lands back in that workspace.
      const calWorkspace = safeSession.get('calendar_workspace')
      safeSession.remove('calendar_workspace')
      // 34-C: POST the code to the provider the connect was started for (Google or Outlook).
      const calProvider = safeSession.get('calendar_provider')
      safeSession.remove('calendar_provider')
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

    const verifier = safeSession.get('pkce_code_verifier')
    const storedState = safeSession.get('pkce_state')

    // BUG-60: a `code` we cannot match to a stored verifier is a dead end — the exchange is
    // impossible and the code is already spent. Leaving `?code=` in the URL invites a reload that
    // re-enters this same branch forever, so strip it and say why. (Distinct from the no-code case,
    // which is just a normal page load and must stay silent.)
    if (code && !verifier) {
      // Side effects only — `storageBlocked` was already derived above, and `authLoading` is
      // already false on this path (a `code` in the URL rules out the cold-start refresh, and this
      // branch is not the calendar return).
      window.history.replaceState({}, '', window.location.pathname)
      recordRumEvent('authStorageBlocked', { at: 'callback' })
      return
    }
    if (!code || !verifier || !returnedState || returnedState !== storedState) return

    safeSession.remove('pkce_code_verifier')
    safeSession.remove('pkce_state')
    // BUG-71: a sign-in return means any calendar-connect markers are from an ABANDONED attempt —
    // the user went to Google for a sign-in, not for the connect. Left behind they accumulate for
    // the life of the tab; the state-match above stops them stranding the gate, and clearing them
    // here stops them lingering at all.
    safeSession.remove('calendar_state')
    safeSession.remove('calendar_verifier')
    safeSession.remove('calendar_workspace')
    safeSession.remove('calendar_provider')
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
    // BUG-60: the verifier is the ONLY thing that can complete the exchange, and it has to survive a
    // full-page redirect — a module global cannot. If the browser refuses to store it, redirecting
    // anyway sends the user to Google and back to a callback that can never finish, indefinitely.
    // Verify the write and stop here instead: a stated reason beats a silent loop.
    const stored = safeSession.verifiedSet('pkce_code_verifier', verifier)
      && safeSession.verifiedSet('pkce_state', state)
    if (!stored) {
      safeSession.remove('pkce_code_verifier')
      safeSession.remove('pkce_state')
      recordRumEvent('authStorageBlocked', { at: 'signIn' })
      setStorageBlocked(true)
      return
    }
    setStorageBlocked(false)
    // The deep-link is different: losing it costs one navigation, so a dropped write is survivable
    // and must NOT block the sign-in.
    const dest = window.location.pathname + window.location.search
    if (dest !== '/') safeSession.set('postLoginRedirect', dest)
    // Never force consent: the first-ever authorization consents once (Google forces it on a
    // not-yet-granted scope), and every later sign-in re-authenticates silently. Lost tokens are
    // restored from the server-side store (30-A), not by re-consenting (30-B).
    hardRedirect(buildAuthUrl(clientId, window.location.origin, challenge, state))
  }, [clientId])

  const signOut = useCallback(() => {
    // BUG-59: the rescued-note text is module state, so it survives sign-out (which does not
    // reload). Without this, a second user signing in on the same tab sees the first user's
    // meeting notes sitting in a banner.
    clearDeletedNote()
    clearToken()
    cancelRefresh()
    setForbidden(false)
    setSessionExpired(false)
    setIdToken(clientId ? null : 'no-auth')
  }, [clientId, cancelRefresh])

  const value = useMemo<AuthState>(
    () => ({ idToken, forbidden, sessionExpired, authLoading, storageBlocked, signIn, signOut }),
    [idToken, forbidden, sessionExpired, authLoading, storageBlocked, signIn, signOut],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
