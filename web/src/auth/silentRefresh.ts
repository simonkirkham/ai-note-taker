// Refresh the session by asking the backend to mint a fresh id_token from the
// httpOnly refresh-token cookie set at sign-in. Replaces the former hidden-iframe
// prompt=none flow, which broke whenever the browser blocked Google's session cookie
// in a third-party iframe (Safari ITP, Firefox ETP, Chrome third-party-cookie phase-out),
// signing the user out roughly every hour.
//
// BUG-90: only the server can end a session. A request that never got an answer — the network
// is not back after the computer wakes, or the desktop app's local proxy could not reach the
// API — used to resolve null exactly like a refusal, and every caller reads null as "signed out".
// So a valid 30-day session was thrown away every morning. Now a 4xx, or a 2xx carrying no token,
// ends the session; anything else (network error, 5xx, an unreadable body) is retried until the
// server answers. There is no retry budget: `navigator.onLine` stays true on Windows machines with
// virtual network adapters, so it cannot be trusted to say the network is down, and signing in
// again needs the same server anyway. The wait between attempts is cut short by the `online` event.
const RETRY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 15_000, 30_000]

let inFlight: Promise<string | null> | null = null
let generation = 0

// Thrown to a caller that set `giveUpAfterMs` when the server has not answered in time. It is NOT a
// refusal — the session may well be fine — so it must never be treated as signed out.
export class RefreshUnavailableError extends Error {
  constructor() {
    super('The server did not answer the session refresh in time')
    this.name = 'RefreshUnavailableError'
  }
}

// Waiting forever is right only for the refresh that keeps an open session alive. Opening the app
// and user actions pass `giveUpAfterMs`, so a broken refresh step ends in a screen the user can act
// on rather than an endless spinner. The shared attempt keeps retrying either way.
export function attemptSilentRefresh(options: { giveUpAfterMs?: number } = {}): Promise<string | null> {
  const shared = sharedAttempt()
  const { giveUpAfterMs } = options
  if (giveUpAfterMs === undefined) return shared
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new RefreshUnavailableError()), giveUpAfterMs)
    shared.then(
      (token) => { clearTimeout(timer); resolve(token) },
      (err: unknown) => { clearTimeout(timer); reject(err instanceof Error ? err : new Error(String(err))) },
    )
  })
}

function sharedAttempt(): Promise<string | null> {
  if (inFlight) return inFlight
  // An attempt abandoned by sign-out can settle after a newer one started; it must not clear that one.
  const attempt: Promise<string | null> = refreshUntilAnswered(generation).finally(() => {
    if (inFlight === attempt) inFlight = null
  })
  inFlight = attempt
  return attempt
}

// Sign-out withdraws a refresh still waiting for the network. The withdrawn attempt never settles:
// a token would sign the user back in, and a null would make the waiting scheduler report the
// session as expired over the top of the sign-in screen.
export function abandonSilentRefresh(): void {
  generation++
  inFlight = null
}

async function refreshUntilAnswered(started: number): Promise<string | null> {
  for (let retry = 0; ; retry++) {
    if (started !== generation) return NEVER
    const answer = await requestRefresh()
    if (started !== generation) return NEVER
    if (answer !== NO_ANSWER) return answer
    await waitForRetry(RETRY_DELAYS_MS[Math.min(retry, RETRY_DELAYS_MS.length - 1)])
  }
}

const NO_ANSWER = Symbol('no-answer')
const NEVER = new Promise<never>(() => {})

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

function waitForRetry(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer)
      window.removeEventListener('online', done)
      resolve()
    }
    const timer = setTimeout(done, ms)
    window.addEventListener('online', done)
  })
}
