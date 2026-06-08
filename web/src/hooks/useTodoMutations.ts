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

// Template note for later Phase 20 slices: these mutations intentionally omit
// `onSettled: invalidateQueries`. Todos is currently the SOLE consumer of
// keys.todos and the optimistic result equals what the server echoes back, so a
// reconciling refetch buys nothing here. A domain with MORE than one consumer
// (folders, note cards, note detail) MUST add
// `onSettled: () => qc.invalidateQueries({ queryKey: keys.<domain> })` so every
// view re-reads — that cross-view sync is the win ADR 0012 is buying.

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
