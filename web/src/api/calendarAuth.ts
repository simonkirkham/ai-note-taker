import { request } from './client'

export type CalendarConnection =
  | { status: 'connected'; provider: string; email: string | null }
  | { status: 'needs_auth'; provider: string | null; email: string | null }

// In-app "Connect calendar": the backend exchanges the auth code server-side (client_secret never
// in the browser) and stores the refresh token per (user, workspace, provider). Requires the bearer.
export function connectGoogleCalendar(
  redirectUri: string,
  code: string,
  codeVerifier: string,
): Promise<{ connected: boolean; provider: string; email: string | null }> {
  return request('/calendar/connect/google', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code, codeVerifier, redirectUri }),
  })
}

// 34-C: in-app "Connect Outlook" — same server-side exchange, against the Microsoft endpoint.
export function connectMicrosoftCalendar(
  redirectUri: string,
  code: string,
  codeVerifier: string,
): Promise<{ connected: boolean; provider: string; email: string | null }> {
  return request('/calendar/connect/microsoft', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code, codeVerifier, redirectUri }),
  })
}

// 34-E: connect via a published ICS feed URL (e.g. Outlook "Publish a calendar") — no OAuth, so it
// bypasses the Microsoft admin-consent wall. The URL is the only credential; the backend validates
// it (SSRF guard + a one-time parse) before storing it as the workspace's "ics" connection.
export function connectIcsCalendar(
  url: string,
): Promise<{ connected: boolean; provider: string }> {
  return request('/calendar/connect/ics', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url }),
  })
}

export function getCalendarConnection(): Promise<CalendarConnection> {
  return request<CalendarConnection>('/calendar/connection')
}

// 34-C: provider-agnostic disconnect — clears the workspace's connection whichever provider it is.
export function disconnectCalendar(): Promise<{ status: string; provider: string | null }> {
  return request('/calendar/disconnect', { method: 'POST' })
}
