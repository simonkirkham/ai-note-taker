import { useQuery } from "@tanstack/react-query";
import { keys } from "../api/queryKeys";
import { getTags } from "../api/tags";

// The global tag index (counts + note ids). Shared by NoteView (suggestions)
// and ListView (home filter) — one fetch, one cache.
export function useTags() {
  return useQuery({ queryKey: keys.tags, queryFn: getTags });
}
