const STORAGE_KEY = 'id_token'

let _token: string | null = null
let _onForbidden: (() => void) | null = null
let _onUnauthorized: (() => void) | null = null
let _onRefresh: (() => Promise<string | null>) | null = null

export function jwtExpired(token: string): boolean {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]))
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
