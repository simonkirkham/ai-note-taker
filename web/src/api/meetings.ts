import { apiFetch, base, request, requestVoid, requestWithResponse } from './client'
import { captureNoteToken } from './notes'

export interface CalendarMeeting {
  calendarEventId: string;
  title: string;
  startTime: string;
  endTime: string;
  isRecurring: boolean;
  recurringSeriesId: string | null;
  linkedNoteId: string | null;
  hasNextOccurrenceNote: boolean;
  nextOccurrenceNoteId: string | null;
}

export type MeetingsResult =
  | { meetings: CalendarMeeting[]; provider: string }
  | { error: string };

// date is an ISO YYYY-MM-DD local day; the caller owns "which day", the server owns the
// local-day window from tz.
export function getMeetingsForDate(tz: string, date: string): Promise<MeetingsResult> {
  return request<MeetingsResult>(`/calendar/${date}?tz=${encodeURIComponent(tz)}`);
}

export async function createNoteFromMeeting(meeting: CalendarMeeting): Promise<{ noteId: string }> {
  // BUG-50: capture the write token so opening the new note gates on the projector catching up
  // (an ungated read races the async projection → 404 → bounced home despite the note existing).
  const { body, response } = await requestWithResponse<{ noteId: string }>(`/notes/from-meeting`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      calendarEventId: meeting.calendarEventId,
      title: meeting.title,
      startTime: meeting.startTime,
      endTime: meeting.endTime,
      isRecurring: meeting.isRecurring,
      recurringSeriesId: meeting.recurringSeriesId,
    }),
  });
  captureNoteToken(body.noteId, response);
  return body;
}

export function linkNoteToCalendar(noteId: string, meeting: CalendarMeeting): Promise<void> {
  return requestVoid(`/notes/${noteId}/calendar-link`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      calendarEventId: meeting.calendarEventId,
      calendarEventTitle: meeting.title,
      startTime: meeting.startTime,
      endTime: meeting.endTime,
      isRecurring: meeting.isRecurring,
      recurringSeriesId: meeting.recurringSeriesId,
    }),
  });
}

// 44-B: detach a note from its meeting. Idempotent server-side (204 even if the
// note is not currently linked).
export function unlinkNoteFromCalendar(noteId: string): Promise<void> {
  return requestVoid(`/notes/${noteId}/calendar-link`, { method: "DELETE" });
}

export type CreateNoteFromNextOccurrenceResult =
  | { noteId: string; alreadyExists: true }
  | { noteId: string; nextOccurrence: { calendarEventId: string; startTime: string; endTime: string } };

export async function createNoteFromNextOccurrence(
  recurringSeriesId: string
): Promise<CreateNoteFromNextOccurrenceResult> {
  const res = await apiFetch(`${base}/notes/from-next-occurrence`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ recurringSeriesId }),
  });
  if (res.status === 404) throw new Error("no_future_occurrences");
  if (!res.ok) throw new Error(`POST /notes/from-next-occurrence failed: ${res.status}`);
  const result = (await res.json()) as CreateNoteFromNextOccurrenceResult;
  // BUG-50: gate the open-after-create read (no-op on the alreadyExists path — no token emitted).
  captureNoteToken(result.noteId, res);
  return result;
}
