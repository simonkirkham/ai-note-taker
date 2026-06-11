import { getToken, jwtExpired, triggerForbidden, triggerRefresh, triggerUnauthorized } from '../auth/tokenStore'
import { getWorkspaceId } from '../workspace/workspaceStore'

export const base = "/api";

// Paths that are NOT workspace-scoped — they stay un-prefixed. Everything else
// (notes, folders, todos, tags, actions) is rewritten to `/w/{wsId}/...` so the
// backend route group resolves it to the active workspace (23-D). The backend also
// dual-maps these rootless → default, so an un-prefixed call still works.
const GLOBAL_PATH_PREFIXES = [
  '/calendar',
  '/transcription/credentials',
  '/notes/from-meeting',
  '/notes/from-next-occurrence',
  '/workspaces',
  '/admin',
];

function scopedPath(path: string): string {
  const wsId = getWorkspaceId();
  // No active workspace (no router context) → send rootless; the backend resolves
  // rootless to the default workspace.
  if (!wsId) return path;
  if (GLOBAL_PATH_PREFIXES.some((p) => path === p || path.startsWith(p + '/') || path.startsWith(p + '?'))) {
    return path;
  }
  return `/w/${wsId}${path}`;
}

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

// --- Transient-failure resilience (Phase 20-G, subsumes 19-H) ---
// Safe *read* requests (GET/HEAD) retry transient failures (5xx / 429 / network
// drop) with exponential backoff + jitter, honouring Retry-After — a failed read
// otherwise leaves blank UI. Writes are NOT retried here: the app's mutations are
// optimistic with immediate rollback (and the QueryClient sets mutations:retry:false),
// so transport-retrying a PUT/DELETE would only delay that rollback; a POST retry
// would risk a duplicate create. Auth (401) is NOT transient and is handled outside
// this loop, in apiFetch. retryConfig is mutable so tests can zero the delay.
export const retryConfig = { maxAttempts: 3, baseDelayMs: 300, maxDelayMs: 4000 }

const RETRYABLE_METHODS = new Set(['GET', 'HEAD'])
function isRetryableMethod(init: RequestInit | undefined): boolean {
  return RETRYABLE_METHODS.has((init?.method ?? 'GET').toUpperCase())
}

function isTransientStatus(status: number): boolean {
  return status >= 500 || status === 429
}

// Retry-After is whole seconds or an HTTP date; returns ms, or null if absent/unparseable.
export function parseRetryAfter(header: string | null): number | null {
  if (!header) return null
  const seconds = Number(header)
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000)
  const when = Date.parse(header)
  return Number.isNaN(when) ? null : Math.max(0, when - Date.now())
}

// Exponential backoff with full jitter, capped. attempt is 1-based (first retry = 1).
export function backoffMs(attempt: number): number {
  const exp = Math.min(retryConfig.maxDelayMs, retryConfig.baseDelayMs * 2 ** (attempt - 1))
  return exp + Math.random() * exp
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// One network attempt with transient retry for idempotent requests. Throws on a
// non-retryable network error; returns the Response otherwise (including 401, which
// the caller handles). Never retries POST.
async function fetchWithRetry(url: string, requestInit: RequestInit, init: RequestInit | undefined): Promise<Response> {
  const retryable = isRetryableMethod(init)
  for (let attempt = 0; ; attempt++) {
    const last = attempt >= retryConfig.maxAttempts - 1
    try {
      const res = await fetch(url, requestInit)
      if (retryable && !last && isTransientStatus(res.status)) {
        console.warn(`apiFetch retry ${attempt + 1}/${retryConfig.maxAttempts - 1} after ${res.status}: ${url}`)
        await sleep(parseRetryAfter(res.headers.get('Retry-After')) ?? backoffMs(attempt + 1))
        continue
      }
      return res
    } catch (err) {
      // A thrown error from fetch is a network failure (TypeError). Retry reads only.
      if (retryable && !last && err instanceof TypeError) {
        console.warn(`apiFetch retry ${attempt + 1}/${retryConfig.maxAttempts - 1} after network error: ${url}`)
        await sleep(backoffMs(attempt + 1))
        continue
      }
      throw err
    }
  }
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
  const res = await fetchWithRetry(url, withAuth(init, token), init)
  if (res.status === 403) triggerForbidden()
  if (res.status === 401) {
    // Auth-retry lives OUTSIDE the transient loop: a 401 is not transient. Fires
    // regardless of whether a token was attached — a 401 must never be swallowed.
    const newToken = await refreshOnce()
    if (!newToken) {
      triggerUnauthorized()
      return res
    }
    const retried = await fetchWithRetry(url, withAuth(init, newToken), init)
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
  const res = await apiFetch(`${base}${scopedPath(path)}`, init)
  ensureOk(res, path, init, okStatuses)
  return res.json() as Promise<T>
}

export async function requestVoid(path: string, init?: RequestInit, okStatuses?: number[]): Promise<void> {
  const res = await apiFetch(`${base}${scopedPath(path)}`, init)
  ensureOk(res, path, init, okStatuses)
}
