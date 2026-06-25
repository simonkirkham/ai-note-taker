import { useQuery } from "@tanstack/react-query";
import { getNoteCards } from "../api/notes";
import { keys } from "../api/queryKeys";

// The single source for the home/folder note list. Replaces App.tsx's hand-rolled
// `cards` state AND the old useNotes() list — one fetch (GET /notes/cards), one cache.
export function useNoteCards() {
  return useQuery({ queryKey: keys.noteCards, queryFn: getNoteCards });
}
