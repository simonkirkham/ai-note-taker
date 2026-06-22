export function generateCodeVerifier(): string {
  const array = new Uint8Array(32)
  crypto.getRandomValues(array)
  return btoa(String.fromCharCode(...array))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '')
}

export async function generateCodeChallenge(verifier: string): Promise<string> {
  const data = new TextEncoder().encode(verifier)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '')
}

export function buildAuthUrl(
  clientId: string,
  redirectUri: string,
  codeChallenge: string,
  state: string,
): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    state,
    // Offline access asks Google for a refresh token (the backend stores it in an httpOnly
    // cookie and refreshes the session without the fragile third-party-cookie iframe).
    access_type: 'offline',
  })
  // We never send prompt=consent. The first-ever authorization shows consent because Google
  // forces it on a not-yet-granted scope (and returns the refresh token 30-A persists); every
  // later sign-in omits prompt → silent re-auth, no consent grant, no Google email (BUG-16).
  // Token loss is recovered from the server-side store (30-A), not by re-forcing consent (30-B).
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`
}

// Token exchange goes through our backend so the client_secret never touches the browser.
export async function exchangeCode(
  redirectUri: string,
  code: string,
  codeVerifier: string,
): Promise<{ id_token: string }> {
  const res = await fetch('/api/auth/token', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code, codeVerifier, redirectUri }),
  })
  if (!res.ok) throw new Error('Token exchange failed')
  return res.json() as Promise<{ id_token: string }>
}
