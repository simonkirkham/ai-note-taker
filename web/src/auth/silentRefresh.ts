// Refresh the session by asking the backend to mint a fresh id_token from the
// httpOnly refresh-token cookie set at sign-in. Replaces the former hidden-iframe
// prompt=none flow, which broke whenever the browser blocked Google's session cookie
// in a third-party iframe (Safari ITP, Firefox ETP, Chrome third-party-cookie phase-out),
// signing the user out roughly every hour.
export function attemptSilentRefresh(): Promise<string | null> {
  return fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' })
    .then((res) => (res.ok ? (res.json() as Promise<unknown>) : null))
    .then((data) => {
      const idToken = (data as { id_token?: unknown } | null)?.id_token
      return typeof idToken === 'string' ? idToken : null
    })
    .catch(() => null)
}
