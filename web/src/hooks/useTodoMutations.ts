import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { completeAction, reopenAction, deleteAction } from "../api/actions";
import { keys } from "../api/queryKeys";
import { completeTodo, reopenTodo, deleteTodo } from "../api/todos";
import type { TodoItem } from "../api/todos";
import { PROJECTOR_LAG_MS } from "./noteCardsCache";

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

// Todos optimism needs no keys.todos reconcile (sole consumer; optimistic == server
// echo). But when the item is an ACTION (20-D), its note's Actions section reads
// keys.actions(noteId) — so on settle we reconcile that key, the other half of the
// action↔todo cross-view loop. keys.actions is projection-backed and lags the write
// under the async projector (27-C), so defer the invalidate by the projector-lag
// budget rather than racing it.
function settleAction(qc: QueryClient, item: TodoItem) {
  if (item.type === "action" && item.noteId) {
    const noteId = item.noteId;
    setTimeout(() => qc.invalidateQueries({ queryKey: keys.actions(noteId) }), PROJECTOR_LAG_MS);
  }
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
    onSettled: (_d, _e, item) => settleAction(qc, item),
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
    onSettled: (_d, _e, item) => settleAction(qc, item),
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
    onSettled: (_d, _e, item) => settleAction(qc, item),
  });
}
