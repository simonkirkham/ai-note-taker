import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import {
  createNoteFromMeeting,
  createNoteFromNextOccurrence,
  linkNoteToCalendar,
  type CalendarMeeting,
  type CreateNoteFromNextOccurrenceResult,
} from "../api/meetings";
import { keys } from "../api/queryKeys";

// Invalidate every date-keyed meetings query (prefix match) — a link/create can
// change a meeting's linked-note state on any cached day, and there are only ever
// a couple of cached days (today + a browsed day).
function invalidateMeetings(qc: QueryClient) {
  return qc.invalidateQueries({ queryKey: ["meetings"] });
}

// Callers own the optimistic list patch / local note-detail optimism (it varies by
// call site — MeetingsSection patches the meetings cache, NoteView keeps local
// linkedMeeting state). These hooks own the API call + cross-domain invalidation.
// keys.note invalidation for NoteView's linkedMeeting/recurringSeriesId is deferred
// to 20-E (note detail not yet migrated).

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
  return useMutation<void, Error, { noteId: string; meeting: CalendarMeeting }>({
    mutationFn: ({ noteId, meeting }) => linkNoteToCalendar(noteId, meeting),
    onSettled: () => invalidateMeetings(qc),
  });
}
