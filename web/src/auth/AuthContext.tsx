import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { buildAuthUrl, exchangeCode, generateCodeChallenge, generateCodeVerifier } from './pkce'
import { clearToken, setToken } from './tokenStore'

interface AuthState {
  idToken: string | null
  signIn: () => Promise<void>
  signOut: () => void
}

export const AuthContext = createContext<AuthState>({
  idToken: null,
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
  const [idToken, setIdToken] = useState<string | null>(initialToken ?? null)
  const mounted = useRef(false)

  useEffect(() => {
    if (mounted.current) return
    mounted.current = true

    if (initialToken) {
      setToken(initialToken)
      return
    }

    const params = new URLSearchParams(window.location.search)
    const code = params.get('code')
    const verifier = sessionStorage.getItem('pkce_code_verifier')

    if (!code || !verifier) return

    sessionStorage.removeItem('pkce_code_verifier')
    window.history.replaceState({}, '', window.location.pathname)

    const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? ''
    exchangeCode(clientId, window.location.origin, code, verifier)
      .then(({ id_token }) => {
        setToken(id_token)
        setIdToken(id_token)
      })
      .catch(() => {})
  }, [])

  async function signIn() {
    const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? ''
    const verifier = generateCodeVerifier()
    const challenge = await generateCodeChallenge(verifier)
    sessionStorage.setItem('pkce_code_verifier', verifier)
    window.location.href = buildAuthUrl(clientId, window.location.origin, challenge)
  }

  function signOut() {
    clearToken()
    setIdToken(null)
  }

  return (
    <AuthContext.Provider value={{ idToken, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthState {
  return useContext(AuthContext)
}
