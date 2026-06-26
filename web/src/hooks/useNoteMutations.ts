import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { moveNoteToFolder, moveNoteToWorkspace, unfileNote } from "../api/folders";
import { createNote, deleteNote, importTranscriptIntoNote, type NoteCard } from "../api/notes";
import { keys } from "../api/queryKeys";

type Ctx = { previous?: NoteCard[] };

async function optimistic(
  qc: QueryClient,
  apply: (cards: NoteCard[]) => NoteCard[],
): Promise<Ctx> {
  await qc.cancelQueries({ queryKey: keys.noteCards });
  const previous = qc.getQueryData<NoteCard[]>(keys.noteCards);
  qc.setQueryData<NoteCard[]>(keys.noteCards, (old) => apply(old ?? []));
  return { previous };
}

function rollback(qc: QueryClient, ctx: Ctx | undefined) {
  if (ctx?.previous) qc.setQueryData(keys.noteCards, ctx.previous);
}

function invalidate(qc: QueryClient) {
  return qc.invalidateQueries({ queryKey: keys.noteCards });
}

// Create returns the server id (navigation keys off it) and inserts the real card
// on success — no temp id. No onSettled invalidate: the card is correct as inserted,
// and a folder assignment (if any) is persisted by useMoveNoteToFolder, whose own
// invalidate reconciles. Avoids a folderId flicker from an early refetch.
export function useCreateNote() {
  const qc = useQueryClient();
  return useMutation<{ noteId: string }, Error, { folderId: string | null }>({
    mutationFn: () => createNote(),
    onSuccess: ({ noteId }, { folderId }) => {
      const now = new Date().toISOString();
      qc.setQueryData<NoteCard[]>(keys.noteCards, (old = []) => [
        {
          noteId, title: "", contentPreview: "", date: now.slice(0, 10),
          openActions: [], createdAt: now, lastModifiedAt: now, tags: [], folderId,
        },
        ...old,
      ]);
    },
  });
}

// Phase 38-B: import a pasted transcript into an existing note (replace + re-analyse). Invalidate
// the cards (the note's preview/tags change); the note-detail refresh is the caller's `onImported`
// (the NoteView's refreshNote), mirroring how RecordControl reconciles after analysis.
export function useImportTranscriptIntoNote(noteId: string) {
  const qc = useQueryClient();
  return useMutation<void, Error, { transcriptText: string }>({
    mutationFn: ({ transcriptText }) => importTranscriptIntoNote(noteId, transcriptText),
    onSuccess: () => invalidate(qc),
  });
}

export function useDeleteNote() {
  const qc = useQueryClient();
  return useMutation<void, Error, string, Ctx>({
    mutationFn: (noteId) => deleteNote(noteId),
    onMutate: (noteId) => optimistic(qc, (cards) => cards.filter((c) => c.noteId !== noteId)),
    onError: (_e, _id, ctx) => rollback(qc, ctx),
    onSettled: () => invalidate(qc),
  });
}

export function useMoveNoteToFolder() {
  const qc = useQueryClient();
  return useMutation<void, Error, { noteId: string; folderId: string | null }, Ctx>({
    mutationFn: ({ noteId, folderId }) =>
      folderId ? moveNoteToFolder(noteId, folderId) : unfileNote(noteId),
    onMutate: ({ noteId, folderId }) =>
      optimistic(qc, (cards) => cards.map((c) => (c.noteId === noteId ? { ...c, folderId } : c))),
    onError: (_e, _v, ctx) => rollback(qc, ctx),
    onSettled: () => invalidate(qc),
  });
}

// Moving a note to another workspace removes it from the current workspace's view —
// optimistically drop the card, reconcile on settle.
export function useMoveNoteToWorkspace() {
  const qc = useQueryClient();
  return useMutation<void, Error, { noteId: string; workspaceId: string }, Ctx>({
    mutationFn: ({ noteId, workspaceId }) => moveNoteToWorkspace(noteId, workspaceId),
    onMutate: ({ noteId }) => optimistic(qc, (cards) => cards.filter((c) => c.noteId !== noteId)),
    onError: (_e, _v, ctx) => rollback(qc, ctx),
    onSettled: () => invalidate(qc),
  });
}
