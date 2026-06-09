import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { NoteDetail } from "../api/notes";
import { keys } from "../api/queryKeys";
import { tagNote, untagNote } from "../api/tags";

// Tagging/untagging changes the global tag index (counts, note ids), so each
// mutation invalidates keys.tags on settle. React Query coalesces concurrent
// invalidations, so a multi-tag paste does not fan out into one refetch per token.
//
// The note's *applied* tags are note-detail state (keys.note(id), migrated in 20-E):
// each mutation optimistically patches that cache and rolls back on error, so the
// open note's tag pills update immediately. keys.note has a single consumer
// (NoteView) so no self-invalidate is needed (optimistic == server).
//
// Tags are only edited inside NoteView; the home-card tag pills are refreshed by
// App's handleBackFromNote (it invalidates keys.noteCards on return to the list).
// We deliberately do NOT invalidate keys.noteCards here: AppContent's useNoteCards
// is always mounted, so it would force a wasteful GET /notes/cards on every tag op
// while the list isn't visible — churn that destabilised the tag E2E journeys.
type Ctx = { previous?: NoteDetail };

async function snapshotNote(qc: QueryClient, noteId: string): Promise<Ctx> {
  await qc.cancelQueries({ queryKey: keys.note(noteId) });
  return { previous: qc.getQueryData<NoteDetail>(keys.note(noteId)) };
}

function patchTags(qc: QueryClient, noteId: string, apply: (tags: string[]) => string[]) {
  qc.setQueryData<NoteDetail>(keys.note(noteId), (old) =>
    old ? { ...old, tags: apply(old.tags) } : old);
}

function rollback(qc: QueryClient, noteId: string, ctx: Ctx | undefined) {
  if (ctx?.previous) qc.setQueryData(keys.note(noteId), ctx.previous);
}

export function useTagNote() {
  const qc = useQueryClient();
  return useMutation<void, Error, { noteId: string; tag: string }, Ctx>({
    mutationFn: ({ noteId, tag }) => tagNote(noteId, tag),
    onMutate: async ({ noteId, tag }) => {
      const ctx = await snapshotNote(qc, noteId);
      patchTags(qc, noteId, (tags) => (tags.includes(tag) ? tags : [...tags, tag]));
      return ctx;
    },
    onError: (_e, { noteId }, ctx) => rollback(qc, noteId, ctx),
    onSettled: () => qc.invalidateQueries({ queryKey: keys.tags }),
  });
}

export function useUntagNote() {
  const qc = useQueryClient();
  return useMutation<void, Error, { noteId: string; tag: string }, Ctx>({
    mutationFn: ({ noteId, tag }) => untagNote(noteId, tag),
    onMutate: async ({ noteId, tag }) => {
      const ctx = await snapshotNote(qc, noteId);
      patchTags(qc, noteId, (tags) => tags.filter((t) => t !== tag));
      return ctx;
    },
    onError: (_e, { noteId }, ctx) => rollback(qc, noteId, ctx),
    onSettled: () => qc.invalidateQueries({ queryKey: keys.tags }),
  });
}
