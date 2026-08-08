import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getNoteDetail, type NoteDetail } from "../api/notes";
import { keys } from "../api/queryKeys";

// While a batch diarization job is running (33-B1), poll the note this often so the diarized
// transcript and transcriptIsDiarized flag surface without a manual reload. The read is RYW-gated
// (gatedRead), so each poll already tolerates projector lag.
const DIARIZATION_POLL_MS = 5000;

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
      // BUG-48: the gate gave up with the projector still behind, so `body` is this note's OLDER
      // state — commonly an empty title/content while the fold catches up. Storing it would
      // overwrite good cached detail and flash the note blank (and flip the header Save→Cancel on
      // `hasContent`). Keep what we have; the token is still held, so the next read re-gates.
      const cached = queryClient.getQueryData<NoteDetail>(keys.note(noteId));
      if (stale && cached) return cached;
      return body;
    },
    refetchInterval: pollForDiarization
      ? (query) => (query.state.data?.transcriptIsDiarized ? false : DIARIZATION_POLL_MS)
      : false,
  });
}
