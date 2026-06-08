import { useQuery } from "@tanstack/react-query";
import { getActions } from "../api/actions";
import { keys } from "../api/queryKeys";

export function useActions(noteId: string) {
  return useQuery({ queryKey: keys.actions(noteId), queryFn: () => getActions(noteId) });
}
