import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getNoteCards, type NoteCard } from '../api/notes';
import { keys } from '../api/queryKeys';

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

// The note currently being protected, and how many stale reads it has been protected through.
// `ConsistencyGate` documents a token that never becomes reachable (the write did not land — BUG-27
// was exactly that), and an unreachable token makes every later read stale forever. Without a
// budget the row would be pinned to its cached value for the whole session, hiding every
// out-of-band update to that note.
//
// Keyed by note, not global (Hawk, PR #459): under sustained lag a single global counter spent on
// note X leaves the NEXT note the user deletes with no protection at all — BUG-44's symptom,
// unmitigated. `useNoteDetail` keys its equivalent state by note id for the same reason. A new
// gated note starts its own budget; a fresh read clears the state, the projection having
// demonstrably caught up.
interface HeldRow {
  noteId: string;
  holds: number;
  warned: boolean;
}

let held: HeldRow | null = null;

// Module state, so one spec's staleness would otherwise leak into the next. Exported for tests
// only; reset globally in web/src/test/setup.ts, alongside the note-detail tracker (BUG-48).
export function resetStaleCardsTrackingForTests(): void {
  held = null;
}

// Structural compare, matching `useNoteDetail`'s `sameBody`: React Query's `structuralSharing`
// rebuilds cached objects, so a reference compare would always miss.
function sameCard(a: NoteCard, b: NoteCard): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

// Replace the gated note's row in the server body with what the cache holds for it — or drop the
// row entirely when the cache does not hold it. `changed` reports whether anything was actually
// protected, so a read where cache and body already agree does not spend budget (Hawk, PR #459).
// A note present in cache but absent from the body is one the user just created; it goes to the
// front only because it has to go somewhere — `GET /notes/cards` applies no ordering and the home
// list re-sorts client-side, so position here is not load-bearing.
function withCachedRow(
  body: NoteCard[],
  cached: NoteCard[],
  noteId: string
): { cards: NoteCard[]; changed: boolean } {
  const mine = cached.find((c) => c.noteId === noteId);
  const index = body.findIndex((c) => c.noteId === noteId);
  if (!mine) {
    if (index === -1) return { cards: body, changed: false };
    return { cards: body.filter((c) => c.noteId !== noteId), changed: true };
  }
  if (index === -1) return { cards: [mine, ...body], changed: true };
  if (sameCard(body[index], mine)) return { cards: body, changed: false };
  return { cards: body.map((c) => (c.noteId === noteId ? mine : c)), changed: true };
}

// The single source for the home/folder note list. Replaces App.tsx's hand-rolled
// `cards` state AND the old useNotes() list — one fetch (GET /notes/cards), one cache.
export function useNoteCards() {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: keys.noteCards,
    // `queryKey` comes from React Query rather than re-reading `keys.noteCards` here: that getter
    // resolves the module-global workspace id at CALL time, so a fetch issued for workspace A that
    // lands after a switch would reconcile A's body against B's cache and write the result back
    // into A's entry — dropping A's just-written note from A's own list (Hawk, PR #459).
    queryFn: async ({ queryKey }) => {
      const { cards, stale, gatedNoteId } = await getNoteCards();
      if (!stale) {
        held = null;
        return cards;
      }
      const cached = queryClient.getQueryData<NoteCard[]>(queryKey);
      if (gatedNoteId == null || cached == null) return cards;

      if (held?.noteId !== gatedNoteId) held = { noteId: gatedNoteId, holds: 0, warned: false };
      if (held.holds >= MAX_HOLDS) {
        if (!held.warned) {
          held.warned = true;
          // Without this the guard is invisible in production: a budget that has run out looks
          // exactly like a guard that never engaged (the blind spot TI-67 documents for RUM).
          console.warn(
            `[notes] stale-read guard gave up on note ${gatedNoteId} after ${MAX_HOLDS} holds — showing the projector's older list`
          );
        }
        return cards;
      }

      const { cards: reconciled, changed } = withCachedRow(cards, cached, gatedNoteId);
      if (changed) held.holds += 1;
      return reconciled;
    },
  });
}
