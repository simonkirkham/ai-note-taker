import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getNoteDetail, type NoteDetail } from "../api/notes";
import { keys } from "../api/queryKeys";

// While a batch diarization job is running (33-B1), poll the note this often so the diarized
// transcript and transcriptIsDiarized flag surface without a manual reload. The read is RYW-gated
// (gatedRead), so each poll already tolerates projector lag.
const DIARIZATION_POLL_MS = 5000;

// BUG-48: whether the body currently cached for a note came from a STALE (given-up) gated read.
//
// The invariant the guard rests on: a per-stream projector position never regresses
// (`IProcessedPositionStore` — "a lower max is a no-op"), so on a single-stream read a `stale`
// verdict means the body is *strictly older* on that stream than the write being gated on. That
// leaves two cases, and only this flag separates them:
//   - cached came from a FRESH read → the stale body is older → keep the cache.
//   - cached came from a STALE read → a newer stale body is closer to the truth → take it.
// A plain "is anything cached?" test collapses the two and pins the cache to the FIRST stale body
// until a fully fresh read lands. That is reachable on the cold path: the RYW token outlives a
// reload (it lives in sessionStorage) but the query cache does not, so after F5 the first read
// caches a stale body and every later, better stale read would be thrown away.
const cachedFromStaleRead = new Map<string, boolean>();

// The map is module state, so a spec seeding one note's staleness would otherwise leak into the
// next. Exported for tests only.
export function resetStaleDetailTrackingForTests(): void {
  cachedFromStaleRead.clear();
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
        cachedFromStaleRead.delete(noteId);
        return body;
      }
      // The gate gave up with the projector still behind, so `body` is this note's older state —
      // commonly an empty title/content while the fold catches up. Storing it over FRESH cached
      // detail flashes the note blank (and flips the header Save→Cancel on `hasContent`). The
      // token is still held (gatedRead clears it only on a fresh read), so the next read re-gates.
      const cached = queryClient.getQueryData<NoteDetail>(keys.note(noteId));
      if (cached && !cachedFromStaleRead.get(noteId)) return cached;
      cachedFromStaleRead.set(noteId, true);
      return body;
    },
    refetchInterval: pollForDiarization
      ? (query) => (query.state.data?.transcriptIsDiarized ? false : DIARIZATION_POLL_MS)
      : false,
  });
}
