import { useQuery } from "@tanstack/react-query";
import { getNoteDetail } from "../api/notes";
import { keys } from "../api/queryKeys";

// The note-detail read for the open note (NoteView). One query on keys.note(id);
// the detail mutations (content/date/analyse/link) and the tag mutations write
// this same cache, so every edit reflects without a manual refetch.
export function useNoteDetail(noteId: string) {
  return useQuery({ queryKey: keys.note(noteId), queryFn: () => getNoteDetail(noteId) });
}
