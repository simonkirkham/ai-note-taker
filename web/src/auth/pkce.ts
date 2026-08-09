import { hardRedirect } from '../lib/hardRedirect'
import { safeSession } from '../lib/safeStorage'
import { recordRumEvent } from '../rum'
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
// offline_access) plus openid/email so the id_token carries the account. CHANGE-26: tenant defaults
// to "common" (work/school AND personal accounts; was "consumers" = personal-only) unless
// VITE_MS_TENANT_ID overrides — matching the backend default. The Entra app's "Supported account
// types" must allow this audience. prompt=select_account always shows the account picker so a
// different account can be chosen even when the browser already has a Microsoft session.
export function buildMicrosoftAuthUrl(
  clientId: string,
  redirectUri: string,
  codeChallenge: string,
  state: string,
): string {
  const tenant = import.meta.env.VITE_MS_TENANT_ID || 'common'
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    response_mode: 'query',
    scope: 'openid email offline_access https://graph.microsoft.com/Calendars.Read',
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    state,
    prompt: 'select_account',
  })
  return `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize?${params}`
}

// Starts the in-app calendar consent redirect for the given provider. Stashes its own verifier/state
// markers (separate from sign-in) so AuthProvider's callback can tell a calendar connect from a
// sign-in, plus the active workspace (34-B — the redirect drops the `/w/:wsId` path) and the chosen
// provider (34-C — the callback POSTs to the matching connect endpoint). No-op when that provider's
// client id is not configured (dev/E2E).
export async function startCalendarConnect(provider: 'google' | 'microsoft' = 'google'): Promise<boolean> {
  const clientId = provider === 'microsoft'
    ? (import.meta.env.VITE_MS_CLIENT_ID ?? '')
    : (import.meta.env.VITE_GOOGLE_CLIENT_ID ?? '')
  if (!clientId) return false
  const verifier = generateCodeVerifier()
  const challenge = await generateCodeChallenge(verifier)
  const state = generateCodeVerifier()
  // BUG-60: these four writes were unguarded, so a storage-refusing browser threw here and crashed
  // the calendar panel. Guarding them alone would be worse, not better: the redirect would still
  // fire and the return would find no verifier. Same rule as sign-in — the verifier and state must
  // be proven to have landed before the navigation, because a redirect cannot be taken back.
  const stored = safeSession.verifiedSet('calendar_verifier', verifier)
    && safeSession.verifiedSet('calendar_state', state)
  if (!stored) {
    safeSession.remove('calendar_verifier')
    safeSession.remove('calendar_state')
    recordRumEvent('authStorageBlocked', { at: 'calendarConnect', provider })
    return false
  }
  // The workspace and provider markers only affect where the user lands and which endpoint the
  // callback posts to, both of which have defaults — losing them must not block the connect.
  safeSession.set('calendar_workspace', getWorkspaceId())
  safeSession.set('calendar_provider', provider)
  const url = provider === 'microsoft'
    ? buildMicrosoftAuthUrl(clientId, window.location.origin, challenge, state)
    : buildCalendarAuthUrl(clientId, window.location.origin, challenge, state)
  hardRedirect(url)
  return true
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
