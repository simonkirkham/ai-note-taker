import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getNoteDetail, type NoteDetail } from "../api/notes";
import { keys } from "../api/queryKeys";

// While a batch diarization job is running (33-B1), poll the note this often so the diarized
// transcript and transcriptIsDiarized flag surface without a manual reload. The read is RYW-gated
// (gatedRead), so each poll already tolerates projector lag.
const DIARIZATION_POLL_MS = 5000;

// BUG-48: a RYW-gated read that exhausts its retries returns `X-Consistency: stale` — the
// projector's OLDER state of this note. React Query stored it, overwriting good cached detail, so
// the note flashed blank and the header flipped Save→Cancel on `hasContent`.
//
// The invariant: a per-stream projector position never regresses (`IProcessedPositionStore` — "a
// lower max is a no-op"), so on a single-stream read `stale` means the body is *strictly older* on
// that stream than the write being gated on. "Hold the cache" is therefore right — but only when
// the cache holds something BETTER, and the queryFn cannot tell that from a flag about its own
// last write:
//   - cache came from a fresh read      → better → hold.
//   - cache was patched by a mutation   → better (it is the user's own change) → hold.
//   - cache IS the stale body we stored → not better → take the newer stale body.
// So we remember the body we last accepted and compare against it, rather than tracking "did I
// last write a stale body". A flag cannot distinguish case 2 from case 3, which is how the first
// two attempts at this guard both stayed wrong: the boolean pinned the note to the first stale
// body, and the "was my last write stale" flag let a later stale read clobber a mutation-patched
// cache — BUG-48's own symptom, on the cold path (Hawk, PR #436).
//
// Compared by value, not reference: React Query's `structuralSharing` runs `replaceEqualDeep`, so
// from the second read onward the cached object is a NEW object built from the body. A reference
// compare would always miss and silently degrade back to the pinning bug.
//
// The hold is bounded. `ConsistencyGate` documents a token that is never reachable ("the write
// didn't land — lastSeq is at head but head < version forever"; BUG-27 was exactly a lost write).
// Holding forever would freeze the note for the whole session, so that no out-of-band update — a
// batch diarization, an MCP write, another tab — could ever appear. After MAX_HOLDS consecutive
// holds we take the stale body: by the monotonicity argument it is never older than what we hold.
const MAX_HOLDS = 3;

interface StaleState {
  // The stale body this hook last stored into the cache, or null while we are holding.
  accepted: NoteDetail | null;
  holds: number;
}

const staleReads = new Map<string, StaleState>();

// Structural compare. Both sides originate from the same JSON shape (the cached value is
// `replaceEqualDeep`'s reconstruction of a previous body), so key order is stable.
function sameBody(a: NoteDetail, b: NoteDetail): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

// The map is module state, so a spec seeding one note's staleness would otherwise leak into the
// next. Exported for tests only; wired into web/src/test/setup.ts alongside resetWorkspaceForTests.
export function resetStaleDetailTrackingForTests(): void {
  staleReads.clear();
}

// The note-detail read for the open note (NoteView). One query on keys.note(id);
// every note-touching mutation (content/date/analyse/tags/transcription/meeting)
// reconciles this same cache, so the view stays consistent without the old
// getNoteDetail-refetch + ref-guard machinery. When pollForDiarization is set, the query
// refetches on an interval until transcriptIsDiarized flips true, then stops (33-B1).
export function useNoteDetail(noteId: string, pollForDiarization = false) {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: keys.note(noteId),
    queryFn: async () => {
      const { body, stale } = await getNoteDetail(noteId);
      if (!stale) {
        // The projection caught up — nothing to protect against any more.
        staleReads.delete(noteId);
        return body;
      }

      const cached = queryClient.getQueryData<NoteDetail>(keys.note(noteId));
      const prev = staleReads.get(noteId);
      const cacheIsOurStaleBody = cached != null && prev?.accepted != null && sameBody(cached, prev.accepted);
      const holds = prev?.holds ?? 0;

      if (cached != null && !cacheIsOurStaleBody && holds < MAX_HOLDS) {
        // The cache holds something better than this older body — a fresh read, or the user's own
        // mutation. Keep it. The token is still held (gatedRead clears it only on a fresh read),
        // so the next read re-gates.
        staleReads.set(noteId, { accepted: prev?.accepted ?? null, holds: holds + 1 });
        return cached;
      }

      staleReads.set(noteId, { accepted: body, holds: 0 });
      return body;
    },
    refetchInterval: pollForDiarization
      ? (query) => (query.state.data?.transcriptIsDiarized ? false : DIARIZATION_POLL_MS)
      : false,
  });
}
