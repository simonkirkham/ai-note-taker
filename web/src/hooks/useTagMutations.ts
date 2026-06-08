import { useMutation, useQueryClient } from "@tanstack/react-query";
import { keys } from "../api/queryKeys";
import { tagNote, untagNote } from "../api/tags";

// Tagging/untagging changes the global tag index (counts, note ids) AND the
// note's home-card tag pills, so each mutation invalidates keys.tags + keys.noteCards
// on settle. The note's *applied* tags stay local in NoteView (note-detail state,
// migrating in 20-E) — these hooks own only the index + card-list reconcile. React
// Query coalesces concurrent invalidations, so a multi-tag paste does not fan out
// into one refetch per token.
function invalidateTagViews(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: keys.tags });
  qc.invalidateQueries({ queryKey: keys.noteCards });
}

export function useTagNote() {
  const qc = useQueryClient();
  return useMutation<void, Error, { noteId: string; tag: string }>({
    mutationFn: ({ noteId, tag }) => tagNote(noteId, tag),
    onSettled: () => invalidateTagViews(qc),
  });
}

export function useUntagNote() {
  const qc = useQueryClient();
  return useMutation<void, Error, { noteId: string; tag: string }>({
    mutationFn: ({ noteId, tag }) => untagNote(noteId, tag),
    onSettled: () => invalidateTagViews(qc),
  });
}
