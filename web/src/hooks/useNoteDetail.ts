import { useQuery } from "@tanstack/react-query";
import { getNoteDetail } from "../api/notes";
import { keys } from "../api/queryKeys";

// The note-detail read for the open note (NoteView). One query on keys.note(id);
// every note-touching mutation (content/date/analyse/tags/transcription/meeting)
// reconciles this same cache, so the view stays consistent without the old
// getNoteDetail-refetch + ref-guard machinery.
export function useNoteDetail(noteId: string) {
  return useQuery({ queryKey: keys.note(noteId), queryFn: () => getNoteDetail(noteId) });
}
