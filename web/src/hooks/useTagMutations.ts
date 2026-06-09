import { useMutation, useQueryClient } from "@tanstack/react-query";
import { keys } from "../api/queryKeys";
import { tagNote, untagNote } from "../api/tags";

// Tagging/untagging changes the global tag index (counts, note ids), so each
// mutation invalidates keys.tags on settle. The note's *applied* tags stay local
// in NoteView (note-detail state, migrating in 20-E). React Query coalesces
// concurrent invalidations, so a multi-tag paste does not fan out into one refetch
// per token.
//
// Tags are only edited inside NoteView; the home-card tag pills are refreshed by
// App's handleBackFromNote (it invalidates keys.noteCards on return to the list).
// We deliberately do NOT invalidate keys.noteCards here: AppContent's useNoteCards
// is always mounted, so it would force a wasteful GET /notes/cards on every tag op
// while the list isn't visible — churn that destabilised the tag E2E journeys.
export function useTagNote() {
  const qc = useQueryClient();
  return useMutation<void, Error, { noteId: string; tag: string }>({
    mutationFn: ({ noteId, tag }) => tagNote(noteId, tag),
    onSettled: () => qc.invalidateQueries({ queryKey: keys.tags }),
  });
}

export function useUntagNote() {
  const qc = useQueryClient();
  return useMutation<void, Error, { noteId: string; tag: string }>({
    mutationFn: ({ noteId, tag }) => untagNote(noteId, tag),
    onSettled: () => qc.invalidateQueries({ queryKey: keys.tags }),
  });
}
