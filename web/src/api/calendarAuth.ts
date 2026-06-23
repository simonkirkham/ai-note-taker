import { request } from './client'

export type CalendarConnection =
  | { status: 'connected'; provider: string; email: string | null }
  | { status: 'needs_auth'; provider: string; email: string | null }

// In-app "Connect calendar": the backend exchanges the auth code server-side (client_secret never
// in the browser) and stores the refresh token per user. Requires the bearer (signed-in user).
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

export function getCalendarConnection(): Promise<CalendarConnection> {
  return request<CalendarConnection>('/calendar/connection')
}

export function disconnectGoogleCalendar(): Promise<{ status: string; provider: string }> {
  return request('/calendar/disconnect/google', { method: 'POST' })
}
