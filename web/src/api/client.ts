import { getToken, jwtExpired, triggerForbidden, triggerRefresh, triggerUnauthorized } from '../auth/tokenStore'

export const base = "/api";

// A single in-flight silent refresh shared by all concurrent 401s. The home screen fires
// several data fetches at once; without this they would each kick off their own refresh.
let refreshInFlight: Promise<string | null> | null = null
function refreshOnce(): Promise<string | null> {
  if (!refreshInFlight) refreshInFlight = triggerRefresh().finally(() => { refreshInFlight = null })
  return refreshInFlight
}

function withAuth(init: RequestInit | undefined, token: string | null): RequestInit {
  const headers = new Headers(init?.headers)
  if (token) headers.set('Authorization', `Bearer ${token}`)
  return { ...init, headers }
}

export async function apiFetch(url: string, init?: RequestInit): Promise<Response> {
  let token = getToken()
  if (token && token.split('.').length === 3 && jwtExpired(token)) {
    // Pre-flight: the token is already expired — try a silent refresh before sending.
    token = await refreshOnce()
    if (!token) {
      triggerUnauthorized()
      return new Response(null, { status: 401 })
    }
  }
  const res = await fetch(url, withAuth(init, token))
  if (res.status === 403) triggerForbidden()
  if (res.status === 401) {
    // Fires regardless of whether a token was attached: a 401 must never be swallowed.
    const newToken = await refreshOnce()
    if (!newToken) {
      triggerUnauthorized()
      return res
    }
    const retried = await fetch(url, withAuth(init, newToken))
    if (retried.status === 401) triggerUnauthorized()
    if (retried.status === 403) triggerForbidden()
    return retried
  }
  return res
}

function ensureOk(res: Response, path: string, init: RequestInit | undefined, okStatuses?: number[]): void {
  if (res.ok || okStatuses?.includes(res.status)) return
  throw new Error(`${init?.method ?? 'GET'} ${path} failed: ${res.status}`)
}

export async function request<T>(path: string, init?: RequestInit, okStatuses?: number[]): Promise<T> {
  const res = await apiFetch(`${base}${path}`, init)
  ensureOk(res, path, init, okStatuses)
  return res.json() as Promise<T>
}

export async function requestVoid(path: string, init?: RequestInit, okStatuses?: number[]): Promise<void> {
  const res = await apiFetch(`${base}${path}`, init)
  ensureOk(res, path, init, okStatuses)
}
