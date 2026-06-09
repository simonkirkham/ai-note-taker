import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { linkNoteToCalendar, type CalendarMeeting } from "../api/meetings";
import { analyseNote, editContent, setNoteDate, type LinkedMeeting, type NoteDetail } from "../api/notes";
import { keys } from "../api/queryKeys";

type Ctx = { previous?: NoteDetail };

// keys.note(noteId) has a single consumer (NoteView), so optimistic == server for
// content/date/link — they snapshot, patch the cache, and roll back on error with no
// self-reconcile. Only analyse refetches, because the server computes the summary/
// discussion/decisions (and new actions) we can't predict optimistically.
async function snapshot(qc: QueryClient, noteId: string): Promise<Ctx> {
  await qc.cancelQueries({ queryKey: keys.note(noteId) });
  return { previous: qc.getQueryData<NoteDetail>(keys.note(noteId)) };
}

function patch(qc: QueryClient, noteId: string, apply: (d: NoteDetail) => NoteDetail) {
  qc.setQueryData<NoteDetail>(keys.note(noteId), (old) => (old ? apply(old) : old));
}

function rollback(qc: QueryClient, noteId: string, ctx: Ctx | undefined) {
  if (ctx?.previous) qc.setQueryData(keys.note(noteId), ctx.previous);
}

export function useEditContent(noteId: string) {
  const qc = useQueryClient();
  return useMutation<void, Error, string, Ctx>({
    mutationFn: (content) => editContent(noteId, content),
    onMutate: async (content) => {
      const ctx = await snapshot(qc, noteId);
      patch(qc, noteId, (d) => ({ ...d, content }));
      return ctx;
    },
    onError: (_e, _v, ctx) => rollback(qc, noteId, ctx),
  });
}

export function useSetNoteDate(noteId: string) {
  const qc = useQueryClient();
  return useMutation<void, Error, string | null, Ctx>({
    mutationFn: (date) => setNoteDate(noteId, date),
    onMutate: async (date) => {
      const ctx = await snapshot(qc, noteId);
      patch(qc, noteId, (d) => ({ ...d, date }));
      return ctx;
    },
    onError: (_e, _v, ctx) => rollback(qc, noteId, ctx),
  });
}

export function useAnalyseNote(noteId: string) {
  const qc = useQueryClient();
  return useMutation<void, Error, void>({
    mutationFn: () => analyseNote(noteId),
    // Refetch the regenerated summary/discussion/decisions and any new actions.
    onSettled: () => {
      qc.invalidateQueries({ queryKey: keys.note(noteId) });
      qc.invalidateQueries({ queryKey: keys.actions(noteId) });
    },
  });
}

export function useLinkNoteToCalendar(noteId: string) {
  const qc = useQueryClient();
  return useMutation<void, Error, CalendarMeeting, Ctx>({
    mutationFn: (meeting) => linkNoteToCalendar(noteId, meeting),
    onMutate: async (meeting) => {
      const ctx = await snapshot(qc, noteId);
      const linked: LinkedMeeting = {
        calendarEventId: meeting.calendarEventId,
        title: meeting.title,
        startTime: meeting.startTime,
        endTime: meeting.endTime,
        recurringSeriesId: meeting.recurringSeriesId,
        isRecurring: meeting.isRecurring,
      };
      patch(qc, noteId, (d) => ({
        ...d,
        linkedMeeting: linked,
        recurringSeriesId: meeting.recurringSeriesId,
      }));
      return ctx;
    },
    onError: (_e, _v, ctx) => rollback(qc, noteId, ctx),
  });
}
