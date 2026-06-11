import { useQuery } from "@tanstack/react-query";
import { keys } from "../api/queryKeys";
import { getWorkspaces } from "../api/workspaces";

export function useWorkspaces() {
  return useQuery({ queryKey: keys.workspaces, queryFn: getWorkspaces });
}
