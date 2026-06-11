import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { NoteDetail } from "../api/notes";
import { keys } from "../api/queryKeys";
import { tagNote, untagNote } from "../api/tags";
import { patchOneCard, rollbackCards, type CardsCtx } from "./noteCardsCache";

// Tagging/untagging changes the global tag index (counts, note ids), so each
// mutation invalidates keys.tags on settle. React Query coalesces concurrent
// invalidations, so a multi-tag paste does not fan out into one refetch per token.
//
// The note's *applied* tags are note-detail state (keys.note(id), migrated in 20-E):
// each mutation optimistically patches that cache and rolls back on error, so the
// open note's tag pills update immediately.
//
// onSettled reconciles keys.note(id) against server truth ONLY when the optimistic
// patch couldn't apply — i.e. the note wasn't cached at onMutate time (ctx.previous
// is undefined). That happens when tagging a freshly-created note while its initial
// keys.note GET is still in flight: patchTags sees `old === undefined` and does
// nothing, the in-flight GET then resolves tagless (it was issued before the tag
// existed), and the pill would never appear (BUG-14). A space-separated multi-tag
// paste widens that window (two concurrent mutations re-reading the cache).
// When the note WAS cached the optimistic patch already holds, so we skip the refetch
// to avoid churn and a stale-GET revert (optimistic == server in that path).
//
// Tags are edited inside NoteView; the home-card tag pills read keys.noteCards.
// Under the async projector (27-C) the cards projection lags a write, so an eager
// invalidate of keys.noteCards on return-to-list refetched stale data and stuck
// (27-C2). Instead each mutation optimistically patches the matching card's `tags`
// in keys.noteCards (and rolls it back on error) so the home card is correct without
// a racing refetch — App's handleBackFromNote no longer invalidates keys.noteCards.
type Ctx = { previous?: NoteDetail } & CardsCtx;

async function snapshotNote(qc: QueryClient, noteId: string): Promise<{ previous?: NoteDetail }> {
  await qc.cancelQueries({ queryKey: keys.note(noteId) });
  return { previous: qc.getQueryData<NoteDetail>(keys.note(noteId)) };
}

function patchTags(qc: QueryClient, noteId: string, apply: (tags: string[]) => string[]) {
  qc.setQueryData<NoteDetail>(keys.note(noteId), (old) =>
    old ? { ...old, tags: apply(old.tags) } : old);
}

function rollback(qc: QueryClient, noteId: string, ctx: Ctx | undefined) {
  if (ctx?.previous) qc.setQueryData(keys.note(noteId), ctx.previous);
  rollbackCards(qc, ctx);
}

function tagMutation(
  call: (noteId: string, tag: string) => Promise<void>,
  apply: (tags: string[], tag: string) => string[],
) {
  return function useTagMutation() {
    const qc = useQueryClient();
    return useMutation<void, Error, { noteId: string; tag: string }, Ctx>({
      mutationFn: ({ noteId, tag }) => call(noteId, tag),
      onMutate: async ({ noteId, tag }) => {
        const noteCtx = await snapshotNote(qc, noteId);
        patchTags(qc, noteId, (tags) => apply(tags, tag));
        const cardsCtx = await patchOneCard(qc, noteId, (c) => ({ ...c, tags: apply(c.tags, tag) }));
        return { ...noteCtx, ...cardsCtx };
      },
      onError: (_e, { noteId }, ctx) => rollback(qc, noteId, ctx),
      onSettled: (_d, _e, { noteId }, ctx) => {
        qc.invalidateQueries({ queryKey: keys.tags });
        if (!ctx?.previous) qc.invalidateQueries({ queryKey: keys.note(noteId) });
      },
    });
  };
}

export const useTagNote = tagMutation(tagNote, (tags, tag) =>
  tags.includes(tag) ? tags : [...tags, tag]);
export const useUntagNote = tagMutation(untagNote, (tags, tag) => tags.filter((t) => t !== tag));
