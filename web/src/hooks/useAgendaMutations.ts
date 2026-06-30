import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { addAgendaItem } from "../api/agenda";
import type { AgendaItem, NoteDetail } from "../api/notes";
import { keys } from "../api/queryKeys";

// Adding an agenda item is note-detail state (keys.note(id)): the mutation optimistically appends
// the item so the header agenda updates immediately, and rolls back on error. The optimistic item
// carries a temp id (and the next capture-order position); onSettled invalidates keys.note(id) so
// the gated refetch reconciles to the server-minted item ids. Mirrors useTagMutations.
//
// onSettled always refetches (unlike tags, which skip when the note was cached): the optimistic
// item holds a TEMP id, so the cache must be reconciled to the real id even on the happy path,
// else a later per-item op (tick/edit/remove in 43-B/C) would target a non-existent id.
type Ctx = { previous?: NoteDetail };

async function snapshotNote(qc: QueryClient, noteId: string): Promise<Ctx> {
  await qc.cancelQueries({ queryKey: keys.note(noteId) });
  return { previous: qc.getQueryData<NoteDetail>(keys.note(noteId)) };
}

export function useAddAgendaItem() {
  const qc = useQueryClient();
  return useMutation<void, Error, { noteId: string; text: string; tempId: string }, Ctx>({
    mutationFn: ({ noteId, text }) => addAgendaItem(noteId, text.trim()),
    onMutate: async ({ noteId, text, tempId }) => {
      const ctx = await snapshotNote(qc, noteId);
      qc.setQueryData<NoteDetail>(keys.note(noteId), (old) => {
        if (!old) return old;
        const item: AgendaItem = { itemId: tempId, text: text.trim(), discussed: false, position: old.agenda.length };
        return { ...old, agenda: [...old.agenda, item] };
      });
      return ctx;
    },
    onError: (_e, { noteId }, ctx) => {
      if (ctx?.previous) qc.setQueryData(keys.note(noteId), ctx.previous);
    },
    onSettled: (_d, _e, { noteId }) => {
      void qc.invalidateQueries({ queryKey: keys.note(noteId) });
    },
  });
}
