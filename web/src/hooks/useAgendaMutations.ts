import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { addAgendaItem, editAgendaItemText, removeAgendaItem, setAgendaItemDiscussed } from "../api/agenda";
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

// Tick / untick (43-B): optimistically flip the matching item's `discussed` in the note cache so
// the checkbox + coverage count update immediately; roll back on error; reconcile on settle.
export function useSetAgendaItemDiscussed() {
  const qc = useQueryClient();
  return useMutation<void, Error, { noteId: string; itemId: string; discussed: boolean }, Ctx>({
    mutationFn: ({ noteId, itemId, discussed }) => setAgendaItemDiscussed(noteId, itemId, discussed),
    onMutate: async ({ noteId, itemId, discussed }) => {
      const ctx = await snapshotNote(qc, noteId);
      qc.setQueryData<NoteDetail>(keys.note(noteId), (old) =>
        old ? { ...old, agenda: old.agenda.map((a) => (a.itemId === itemId ? { ...a, discussed } : a)) } : old);
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

// Edit text (43-C): optimistically patch the matching item's text; roll back on error; reconcile.
export function useEditAgendaItemText() {
  const qc = useQueryClient();
  return useMutation<void, Error, { noteId: string; itemId: string; text: string }, Ctx>({
    mutationFn: ({ noteId, itemId, text }) => editAgendaItemText(noteId, itemId, text.trim()),
    onMutate: async ({ noteId, itemId, text }) => {
      const ctx = await snapshotNote(qc, noteId);
      qc.setQueryData<NoteDetail>(keys.note(noteId), (old) =>
        old ? { ...old, agenda: old.agenda.map((a) => (a.itemId === itemId ? { ...a, text: text.trim() } : a)) } : old);
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

// Remove (43-C): optimistically drop the item from the list; roll back on error; reconcile.
export function useRemoveAgendaItem() {
  const qc = useQueryClient();
  return useMutation<void, Error, { noteId: string; itemId: string }, Ctx>({
    mutationFn: ({ noteId, itemId }) => removeAgendaItem(noteId, itemId),
    onMutate: async ({ noteId, itemId }) => {
      const ctx = await snapshotNote(qc, noteId);
      qc.setQueryData<NoteDetail>(keys.note(noteId), (old) =>
        old ? { ...old, agenda: old.agenda.filter((a) => a.itemId !== itemId) } : old);
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
