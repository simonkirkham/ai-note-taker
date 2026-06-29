import { useQuery } from "@tanstack/react-query";
import { getFolders } from "../api/folders";
import { keys } from "../api/queryKeys";

export function useFolders() {
  return useQuery({ queryKey: keys.folders, queryFn: getFolders });
}
