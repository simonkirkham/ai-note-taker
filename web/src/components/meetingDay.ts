// Day-navigation helpers shared by the home meetings section and the link-to-meeting picker.
// "Which day" is owned by the client: an ISO YYYY-MM-DD local day; the server owns the
// local-day window from tz (Phase 16 contract).

export function todayInTz(tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());
}

// The local day (YYYY-MM-DD) an instant falls on in tz — used to open the meeting picker
// on the day of the meeting a note is already linked to when changing it (Phase 44).
export function dayInTz(iso: string, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date(iso));
}

// Step an ISO YYYY-MM-DD day by n, calculating in UTC so no DST/midnight shift moves the date.
export function addDays(isoDate: string, n: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function dayDelta(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export function formatMeetingTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
