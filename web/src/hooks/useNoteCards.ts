import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getNoteCards, type NoteCard } from "../api/notes";
import { keys } from "../api/queryKeys";

// TI-65 / BUG-44: the home list is RYW-gated. When the projector is behind, the gate gives up after
// its bounded retries and answers `X-Consistency: stale` — the projection as it was BEFORE the write
// the user just made. Storing that body verbatim is what brought a deleted note back (still
// openable), dropped a just-created one, and snapped a just-moved one to its old folder.
//
// This is deliberately NOT BUG-48's remedy. There, "hold the cached body" is safe because a
// single-entity read is one stream and a per-stream projector position never regresses, so a stale
// body is strictly older. A LIST is many streams and the gate only ever waits on the ONE the user
// most recently wrote (design decision #7), so `stale` says the body is behind on that note and
// says nothing about the rest. Holding the whole cached list would pin another tab's deletion into
// view or hide its addition — a worse failure than the one being fixed.
//
// So the stale body IS taken as the new list, with exactly one row reconciled from cache: the note
// the gate was waiting on. Cache lacks it → the user deleted or moved it away, keep it out. Cache
// has it → that row is the user's own optimistic change, keep it.
//
// This works here and does not generalise to the other gated lists: every cards mutation patches
// the cache with the SERVER note id (useCreateNote inserts in `onSuccess`), so the gated id and the
// cached row agree. `useAddAction`, `useCreateFolder` and `useCreateWorkspace` all patch with a
// temp id first, where the same reconcile would read "cache lacks the gated row" and hide the thing
// just created. Those three need their own decision — TI-65 stays open for them.
const MAX_HOLDS = 3;

// Consecutive stale reads this guard has protected a row through. `ConsistencyGate` documents a
// token that never becomes reachable (the write did not land — BUG-27 was exactly that), and an
// unreachable token makes every subsequent read stale forever. Without a budget the row would be
// pinned to the cached value for the whole session, hiding every out-of-band update to that note.
// A fresh read re-arms it: the projection has demonstrably caught up.
//
// One counter, not one per workspace: `keys.noteCards` is workspace-scoped, so a lagging workspace
// can spend budget the next one would have had. Deliberate — the budget only ever shortens the
// protection, any fresh read in either workspace re-arms it, and per-workspace state buys nothing a
// user could notice.
let holds = 0;

// Module state, so one spec's staleness would otherwise leak into the next. Exported for tests
// only; reset globally in web/src/test/setup.ts, alongside the note-detail tracker (BUG-48).
export function resetStaleCardsTrackingForTests(): void {
  holds = 0;
}

// Replace the gated note's row in the server body with what the cache holds for it — or drop the
// row entirely when the cache does not hold it. A note absent from the body but present in cache is
// one the user just created, so it goes to the front: the list is newest-first and a just-written
// note is the most recently modified.
function withCachedRow(body: NoteCard[], cached: NoteCard[], noteId: string): NoteCard[] {
  const mine = cached.find((c) => c.noteId === noteId);
  if (!mine) return body.filter((c) => c.noteId !== noteId);
  const index = body.findIndex((c) => c.noteId === noteId);
  if (index === -1) return [mine, ...body];
  return body.map((c) => (c.noteId === noteId ? mine : c));
}

// The single source for the home/folder note list. Replaces App.tsx's hand-rolled
// `cards` state AND the old useNotes() list — one fetch (GET /notes/cards), one cache.
export function useNoteCards() {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: keys.noteCards,
    queryFn: async () => {
      const { cards, stale, gatedNoteId } = await getNoteCards();
      if (!stale) {
        holds = 0;
        return cards;
      }
      const cached = queryClient.getQueryData<NoteCard[]>(keys.noteCards);
      if (gatedNoteId == null || cached == null || holds >= MAX_HOLDS) return cards;
      holds += 1;
      return withCachedRow(cards, cached, gatedNoteId);
    },
  });
}
