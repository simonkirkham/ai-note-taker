import { useQuery } from "@tanstack/react-query";
import { getNoteDetail } from "../api/notes";
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
  return useQuery({
    queryKey: keys.note(noteId),
    queryFn: () => getNoteDetail(noteId),
    refetchInterval: pollForDiarization
      ? (query) => (query.state.data?.transcriptIsDiarized ? false : DIARIZATION_POLL_MS)
      : false,
  });
}
