import { getWorkspaceId } from '../workspace/workspaceStore'

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

// Phase 34-A: the in-app "Connect calendar" consent. Unlike sign-in, it requests the
// calendar.readonly scope and forces prompt=consent so Google returns a refresh token the backend
// can store server-side (a prior grant would otherwise omit it). Redirects back to the app origin;
// the callback is distinguished from sign-in by a separate `calendar_state` marker.
export function buildCalendarAuthUrl(
  clientId: string,
  redirectUri: string,
  codeChallenge: string,
  state: string,
): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email https://www.googleapis.com/auth/calendar.readonly',
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    state,
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
  })
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`
}

// Phase 34-C: the in-app "Connect Outlook" consent against the Microsoft identity platform
// (auth-code + PKCE, public client). Scopes mirror MicrosoftCalendarClient (Calendars.Read +
// offline_access) plus openid/email so the id_token carries the account. Tenant defaults to
// "consumers" (personal accounts) unless VITE_MS_TENANT_ID is set — matching the backend default.
export function buildMicrosoftAuthUrl(
  clientId: string,
  redirectUri: string,
  codeChallenge: string,
  state: string,
): string {
  const tenant = import.meta.env.VITE_MS_TENANT_ID || 'consumers'
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    response_mode: 'query',
    scope: 'openid email offline_access https://graph.microsoft.com/Calendars.Read',
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    state,
    prompt: 'consent',
  })
  return `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize?${params}`
}

// Starts the in-app calendar consent redirect for the given provider. Stashes its own verifier/state
// markers (separate from sign-in) so AuthProvider's callback can tell a calendar connect from a
// sign-in, plus the active workspace (34-B — the redirect drops the `/w/:wsId` path) and the chosen
// provider (34-C — the callback POSTs to the matching connect endpoint). No-op when that provider's
// client id is not configured (dev/E2E).
export async function startCalendarConnect(provider: 'google' | 'microsoft' = 'google'): Promise<void> {
  const clientId = provider === 'microsoft'
    ? (import.meta.env.VITE_MS_CLIENT_ID ?? '')
    : (import.meta.env.VITE_GOOGLE_CLIENT_ID ?? '')
  if (!clientId) return
  const verifier = generateCodeVerifier()
  const challenge = await generateCodeChallenge(verifier)
  const state = generateCodeVerifier()
  sessionStorage.setItem('calendar_verifier', verifier)
  sessionStorage.setItem('calendar_state', state)
  sessionStorage.setItem('calendar_workspace', getWorkspaceId())
  sessionStorage.setItem('calendar_provider', provider)
  const url = provider === 'microsoft'
    ? buildMicrosoftAuthUrl(clientId, window.location.origin, challenge, state)
    : buildCalendarAuthUrl(clientId, window.location.origin, challenge, state)
  window.location.href = url
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
