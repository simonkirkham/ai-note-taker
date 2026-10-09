// Refresh the session by asking the backend to mint a fresh id_token from the
// httpOnly refresh-token cookie set at sign-in. Replaces the former hidden-iframe
// prompt=none flow, which broke whenever the browser blocked Google's session cookie
// in a third-party iframe (Safari ITP, Firefox ETP, Chrome third-party-cookie phase-out),
// signing the user out roughly every hour.
//
// BUG-90: only the server can end a session. A request that never got an answer — the network
// is not back after the computer wakes, or the desktop app's local proxy could not reach the
// API — used to resolve null exactly like a refusal, and every caller reads null as "signed out".
// So a valid 30-day session was thrown away every morning. Now: a 2xx/4xx is the server's answer
// and is returned as-is; anything else is retried, indefinitely while the browser reports itself
// offline (signing in again could not work then either), and on a bounded backoff while online.
const RETRY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 15_000, 30_000, 30_000, 30_000]

let inFlight: Promise<string | null> | null = null

export function attemptSilentRefresh(): Promise<string | null> {
  if (!inFlight) inFlight = refreshUntilAnswered().finally(() => { inFlight = null })
  return inFlight
}

async function refreshUntilAnswered(): Promise<string | null> {
  for (let retry = 0; ; ) {
    const answer = await requestRefresh()
    if (answer !== NO_ANSWER) return answer
    if (isOffline()) {
      await waitForOnline()
      continue
    }
    if (retry >= RETRY_DELAYS_MS.length) return null
    await sleep(RETRY_DELAYS_MS[retry++])
  }
}

const NO_ANSWER = Symbol('no-answer')

async function requestRefresh(): Promise<string | null | typeof NO_ANSWER> {
  try {
    const res = await fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' })
    if (res.status >= 500) return NO_ANSWER
    if (!res.ok) return null
    const data = await res.json() as { id_token?: unknown } | null
    return typeof data?.id_token === 'string' ? data.id_token : null
  } catch {
    return NO_ANSWER
  }
}

function isOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false
}

function waitForOnline(): Promise<void> {
  return new Promise((resolve) => window.addEventListener('online', () => resolve(), { once: true }))
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
