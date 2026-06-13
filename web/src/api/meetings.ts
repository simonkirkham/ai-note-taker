import { apiFetch, base, request, requestVoid } from './client'

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
  | { meetings: CalendarMeeting[] }
  | { error: string };

// date is an ISO YYYY-MM-DD local day; the caller owns "which day", the server owns the
// local-day window from tz.
export function getMeetingsForDate(tz: string, date: string): Promise<MeetingsResult> {
  return request<MeetingsResult>(`/calendar/${date}?tz=${encodeURIComponent(tz)}`);
}

export function createNoteFromMeeting(meeting: CalendarMeeting): Promise<{ noteId: string }> {
  return request<{ noteId: string }>(`/notes/from-meeting`, {
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
  return res.json() as Promise<CreateNoteFromNextOccurrenceResult>;
}
