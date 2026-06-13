const STORAGE_KEY = 'id_token'
// Browser-local evidence that a Google refresh token is on file for this user (BUG-16).
// signIn forces prompt=consent only when this is absent, so a returning user re-authenticates
// silently — no fresh consent grant, no Google sign-in email. Set whenever a token is acquired
// (silent refresh or interactive exchange); cleared when a refresh genuinely fails (token gone),
// so the next sign-in re-consents and obtains a new refresh token.
const REFRESH_ESTABLISHED_KEY = 'google_refresh_established'

let _token: string | null = null
let _onForbidden: (() => void) | null = null
let _onUnauthorized: (() => void) | null = null
let _onRefresh: (() => Promise<string | null>) | null = null

export function jwtExpired(token: string): boolean {
  try {
    const payload = JSON.parse(atob(token.split('.')[1])) as { exp?: unknown }
    return typeof payload.exp === 'number' && payload.exp * 1000 < Date.now()
  } catch {
    return true
  }
}

export function loadPersistedToken(): string | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored && !jwtExpired(stored)) return stored
    if (stored) localStorage.removeItem(STORAGE_KEY)
  } catch { /* localStorage unavailable */ }
  return null
}

export const isRefreshEstablished = (): boolean => {
  // Fail-safe: if localStorage is unavailable (locked-down browser), report "not established"
  // so signIn forces consent — the user always gets a refresh token, never a broken session.
  try { return localStorage.getItem(REFRESH_ESTABLISHED_KEY) === '1' } catch { return false }
}
export const markRefreshEstablished = (): void => {
  try { localStorage.setItem(REFRESH_ESTABLISHED_KEY, '1') } catch { /* ignore */ }
}
export const clearRefreshEstablished = (): void => {
  try { localStorage.removeItem(REFRESH_ESTABLISHED_KEY) } catch { /* ignore */ }
}

export const getToken = (): string | null => _token
export const setToken = (token: string): void => {
  _token = token
  try { localStorage.setItem(STORAGE_KEY, token) } catch { /* ignore */ }
}
export const clearToken = (): void => {
  _token = null
  try { localStorage.removeItem(STORAGE_KEY) } catch { /* ignore */ }
}
export const setOnForbidden = (cb: () => void): void => { _onForbidden = cb }
export const triggerForbidden = (): void => { _onForbidden?.() }
export const setOnUnauthorized = (cb: () => void): void => { _onUnauthorized = cb }
export const triggerUnauthorized = (): void => { _onUnauthorized?.() }
export const setOnRefresh = (cb: () => Promise<string | null>): void => { _onRefresh = cb }
export const triggerRefresh = (): Promise<string | null> => _onRefresh ? _onRefresh() : Promise.resolve(null)
