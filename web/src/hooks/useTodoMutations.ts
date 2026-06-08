import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { completeAction, reopenAction, deleteAction } from "../api/actions";
import { keys } from "../api/queryKeys";
import { completeTodo, reopenTodo, deleteTodo } from "../api/todos";
import type { TodoItem } from "../api/todos";

type Ctx = { previous?: TodoItem[] };

// Snapshot the todos cache, apply an optimistic transform, and return the snapshot for rollback.
async function optimistic(qc: QueryClient, apply: (items: TodoItem[]) => TodoItem[]): Promise<Ctx> {
  await qc.cancelQueries({ queryKey: keys.todos });
  const previous = qc.getQueryData<TodoItem[]>(keys.todos);
  qc.setQueryData<TodoItem[]>(keys.todos, (old) => apply(old ?? []));
  return { previous };
}

function rollback(qc: QueryClient, ctx: Ctx | undefined) {
  if (ctx?.previous) qc.setQueryData(keys.todos, ctx.previous);
}

export function useCompleteTodo() {
  const qc = useQueryClient();
  return useMutation<void, Error, TodoItem, Ctx>({
    mutationFn: (item) =>
      item.type === "action" ? completeAction(item.noteId!, item.itemId) : completeTodo(item.itemId),
    onMutate: (item) => {
      const completedAt = new Date().toISOString();
      return optimistic(qc, (items) =>
        items.map((i) => (i.itemId === item.itemId ? { ...i, completedAt } : i)));
    },
    onError: (_e, _item, ctx) => rollback(qc, ctx),
  });
}

export function useReopenTodo() {
  const qc = useQueryClient();
  return useMutation<void, Error, TodoItem, Ctx>({
    mutationFn: (item) =>
      item.type === "action" ? reopenAction(item.noteId!, item.itemId) : reopenTodo(item.itemId),
    onMutate: (item) =>
      optimistic(qc, (items) =>
        items.map((i) => (i.itemId === item.itemId ? { ...i, completedAt: null } : i))),
    onError: (_e, _item, ctx) => rollback(qc, ctx),
  });
}

export function useDeleteTodo() {
  const qc = useQueryClient();
  return useMutation<void, Error, TodoItem, Ctx>({
    mutationFn: (item) =>
      item.type === "action" ? deleteAction(item.noteId!, item.itemId) : deleteTodo(item.itemId),
    onMutate: (item) =>
      optimistic(qc, (items) => items.filter((i) => i.itemId !== item.itemId)),
    onError: (_e, _item, ctx) => rollback(qc, ctx),
  });
}
