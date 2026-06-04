// Named context.ts, not authContext.ts: /mnt/c is case-insensitive, so authContext.ts
// would collide with the sibling AuthContext.tsx. Don't "fix" the name.
import { createContext, useContext } from 'react'

export interface AuthState {
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

export function useAuth(): AuthState {
  return useContext(AuthContext)
}
