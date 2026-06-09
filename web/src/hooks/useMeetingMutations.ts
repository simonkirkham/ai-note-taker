import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import {
  createNoteFromMeeting,
  createNoteFromNextOccurrence,
  linkNoteToCalendar,
  type CalendarMeeting,
  type CreateNoteFromNextOccurrenceResult,
} from "../api/meetings";
import type { LinkedMeeting, NoteDetail } from "../api/notes";
import { keys } from "../api/queryKeys";

// Invalidate every date-keyed meetings query (prefix match) — a link/create can
// change a meeting's linked-note state on any cached day, and there are only ever
// a couple of cached days (today + a browsed day).
function invalidateMeetings(qc: QueryClient) {
  return qc.invalidateQueries({ queryKey: ["meetings"] });
}

// MeetingsSection owns its meetings-cache list patch. NoteView's note-detail
// optimism (linkedMeeting/recurringSeriesId) is owned by useLinkNoteToCalendar
// below since 20-E migrated keys.note. These hooks own the API call + invalidation.

type LinkCtx = { previous?: NoteDetail };

export function useCreateNoteFromMeeting() {
  const qc = useQueryClient();
  return useMutation<{ noteId: string }, Error, CalendarMeeting>({
    mutationFn: (meeting) => createNoteFromMeeting(meeting),
    onSettled: () => {
      invalidateMeetings(qc);
      qc.invalidateQueries({ queryKey: keys.noteCards });
    },
  });
}

export function useCreateNoteFromNextOccurrence() {
  const qc = useQueryClient();
  return useMutation<CreateNoteFromNextOccurrenceResult, Error, string>({
    mutationFn: (recurringSeriesId) => createNoteFromNextOccurrence(recurringSeriesId),
    onSettled: () => {
      invalidateMeetings(qc);
      qc.invalidateQueries({ queryKey: keys.noteCards });
    },
  });
}

export function useLinkNoteToCalendar() {
  const qc = useQueryClient();
  return useMutation<void, Error, { noteId: string; meeting: CalendarMeeting }, LinkCtx>({
    mutationFn: ({ noteId, meeting }) => linkNoteToCalendar(noteId, meeting),
    // Optimistically patch the open note's linkedMeeting/recurringSeriesId; roll back
    // on error. The badge reads from keys.note, so this is the link optimism.
    onMutate: async ({ noteId, meeting }) => {
      await qc.cancelQueries({ queryKey: keys.note(noteId) });
      const previous = qc.getQueryData<NoteDetail>(keys.note(noteId));
      const linked: LinkedMeeting = {
        calendarEventId: meeting.calendarEventId,
        title: meeting.title,
        startTime: meeting.startTime,
        endTime: meeting.endTime,
        recurringSeriesId: meeting.recurringSeriesId,
        isRecurring: meeting.isRecurring,
      };
      qc.setQueryData<NoteDetail>(keys.note(noteId), (old) =>
        old ? { ...old, linkedMeeting: linked, recurringSeriesId: meeting.recurringSeriesId } : old);
      return { previous };
    },
    onError: (_e, { noteId }, ctx) => {
      if (ctx?.previous) qc.setQueryData(keys.note(noteId), ctx.previous);
    },
    // keys.note is patched optimistically above (single consumer == server), so we
    // only invalidate the meetings list (the linked-note state changed there).
    onSettled: () => invalidateMeetings(qc),
  });
}
