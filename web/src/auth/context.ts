// Named context.ts, not authContext.ts: /mnt/c is case-insensitive, so authContext.ts
// would collide with the sibling AuthContext.tsx. Don't "fix" the name.
import { createContext, useContext } from 'react'

export interface AuthState {
  idToken: string | null
  forbidden: boolean
  sessionExpired: boolean
  // True only during a cold-start silent refresh — the in-memory token has lapsed
  // but the refresh cookie may still restore the session, so the gate shows a
  // loading state rather than flashing the sign-in screen (BUG-15).
  authLoading: boolean
  signIn: () => Promise<void>
  signOut: () => void
}

export const AuthContext = createContext<AuthState>({
  idToken: null,
  forbidden: false,
  sessionExpired: false,
  authLoading: false,
  signIn: async () => {},
  signOut: () => {},
})

export function useAuth(): AuthState {
  return useContext(AuthContext)
}
