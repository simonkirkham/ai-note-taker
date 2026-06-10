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
  forceConsent: boolean,
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
  // prompt=consent forces a fresh consent grant — which is what makes Google return a refresh
  // token AND send the "info you shared" email. Force it only when the client has no refresh
  // token on file (first auth, or after the token expired/was revoked). A returning user omits
  // prompt, so Google re-authenticates silently — no consent grant, no email (BUG-16).
  if (forceConsent) params.set('prompt', 'consent')
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
  return res.json()
}
