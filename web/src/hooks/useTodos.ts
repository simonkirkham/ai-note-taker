import { useQuery } from "@tanstack/react-query";
import { keys } from "../api/queryKeys";
import { getTodos } from "../api/todos";

export function useTodos() {
  return useQuery({ queryKey: keys.todos, queryFn: getTodos });
}
