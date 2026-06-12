import { useMutation, useQueryClient } from "@tanstack/react-query";
import { analyseNote, editContent, setNoteDate, type NoteDetail } from "../api/notes";
import { keys } from "../api/queryKeys";

// Note-detail commits. keys.note has a single consumer (NoteView), so per the
// keystone principle the saved value is optimistic == server: content/date patch
// keys.note on success (NoteView's draft then reconciles to it) rather than
// self-invalidating — a keys.note refetch on every blur is wasted churn and, with
// the home card, the only cross-view consumer is keys.noteCards (the card
// preview/date), which we invalidate. Analyse is the exception: the server computes
// the summary/discussion/decisions (and may extract actions), so it must refetch
// keys.note + keys.actions (the latter replaces the old actionsKey remount).

export function useEditContent(noteId: string) {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (content) => editContent(noteId, content),
    onSuccess: (_d, content) =>
      qc.setQueryData<NoteDetail>(keys.note(noteId), (old) => (old ? { ...old, content } : old)),
    onSettled: () => qc.invalidateQueries({ queryKey: keys.noteCards }),
  });
}

export function useSetNoteDate(noteId: string) {
  const qc = useQueryClient();
  return useMutation<void, Error, string | null>({
    mutationFn: (date) => setNoteDate(noteId, date),
    onSuccess: (_d, date) =>
      qc.setQueryData<NoteDetail>(keys.note(noteId), (old) => (old ? { ...old, date } : old)),
    onSettled: () => qc.invalidateQueries({ queryKey: keys.noteCards }),
  });
}

export function useAnalyseNote(noteId: string) {
  const qc = useQueryClient();
  return useMutation<void, Error, void>({
    mutationFn: () => analyseNote(noteId),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: keys.note(noteId) });
      qc.invalidateQueries({ queryKey: keys.actions(noteId) });
    },
  });
}
