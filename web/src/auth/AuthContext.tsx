import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { buildAuthUrl, exchangeCode, generateCodeChallenge, generateCodeVerifier } from './pkce'
import { clearToken, loadPersistedToken, setToken, setOnForbidden, setOnUnauthorized } from './tokenStore'
import { getExp, useGoogleAuth } from './useGoogleAuth'

interface AuthState {
  idToken: string | null
  forbidden: boolean
  sessionExpired: boolean
  signIn: () => Promise<void>
  signOut: () => void
}

export const AuthContext = createContext<AuthState>({
  idToken: null,
  forbidden: false,
  sessionExpired: false,
  signIn: async () => {},
  signOut: () => {},
})

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
  const [idToken, setIdToken] = useState<string | null>(initialToken ?? persisted ?? (clientId ? null : 'no-auth'))
  const [forbidden, setForbidden] = useState(false)
  const [sessionExpired, setSessionExpired] = useState(false)
  const mounted = useRef(false)

  const handleRefreshSuccess = useCallback((token: string) => {
    setToken(token)
    setIdToken(token)
    setSessionExpired(false)
  }, [])

  const handleRefreshFailure = useCallback(() => {
    clearToken()
    setIdToken(null)
    setSessionExpired(true)
  }, [])

  const { scheduleRefresh, cancelRefresh } = useGoogleAuth({
    clientId,
    onRefreshSuccess: handleRefreshSuccess,
    onRefreshFailure: handleRefreshFailure,
  })

  useEffect(() => {
    if (persisted) setToken(persisted)
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
  }, [cancelRefresh])

  // Schedule token refresh whenever a real token is loaded or replaced
  useEffect(() => {
    if (!idToken || !clientId || idToken === 'no-auth') return
    const exp = getExp(idToken)
    if (exp) scheduleRefresh(exp)
  }, [idToken, clientId, scheduleRefresh])

  useEffect(() => {
    if (mounted.current) return
    mounted.current = true

    if (initialToken) {
      setToken(initialToken)
      return
    }

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
  }, [])

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

export function useAuth(): AuthState {
  return useContext(AuthContext)
}
