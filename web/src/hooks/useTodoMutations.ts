import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { completeAction, reopenAction, editAction, deleteAction } from "../api/actions";
import { keys } from "../api/queryKeys";
import { completeTodo, reopenTodo, editTodo, deleteTodo, reorderTodos, setTodayLine } from "../api/todos";
import type { TodoItem, TodoListData } from "../api/todos";

type Ctx = { previous?: TodoListData };

const EMPTY: TodoListData = { items: [], todayLineAnchorItemId: null };

// Snapshot the todos cache, apply an optimistic transform, and return the snapshot for rollback.
async function optimistic(qc: QueryClient, apply: (data: TodoListData) => TodoListData): Promise<Ctx> {
  await qc.cancelQueries({ queryKey: keys.todos });
  const previous = qc.getQueryData<TodoListData>(keys.todos);
  qc.setQueryData<TodoListData>(keys.todos, (old) => apply(old ?? EMPTY));
  return { previous };
}

// Most mutations only touch the items; the Today line rides along untouched.
function mapItems(apply: (items: TodoItem[]) => TodoItem[]) {
  return (data: TodoListData): TodoListData => ({ ...data, items: apply(data.items) });
}

function rollback(qc: QueryClient, ctx: Ctx | undefined) {
  if (ctx?.previous) qc.setQueryData(keys.todos, ctx.previous);
}

// Todos optimism needs no keys.todos reconcile (sole consumer; optimistic == server
// echo). But when the item is an ACTION (20-D), its note's Actions section reads
// keys.actions(noteId) — so on settle we invalidate that key, the other half of the
// action↔todo cross-view loop (the action mutations invalidate keys.todos in turn).
function settleAction(qc: QueryClient, item: TodoItem) {
  if (item.type === "action" && item.noteId) {
    void qc.invalidateQueries({ queryKey: keys.actions(item.noteId) });
  }
}

export function useCompleteTodo() {
  const qc = useQueryClient();
  return useMutation<void, Error, TodoItem, Ctx>({
    mutationFn: (item) =>
      item.type === "action" ? completeAction(item.noteId, item.itemId) : completeTodo(item.itemId),
    onMutate: (item) => {
      const completedAt = new Date().toISOString();
      return optimistic(qc, mapItems((items) =>
        items.map((i) => (i.itemId === item.itemId ? { ...i, completedAt } : i))));
    },
    onError: (_e, _item, ctx) => rollback(qc, ctx),
    onSettled: (_d, _e, item) => settleAction(qc, item),
  });
}

export function useReopenTodo() {
  const qc = useQueryClient();
  return useMutation<void, Error, TodoItem, Ctx>({
    mutationFn: (item) =>
      item.type === "action" ? reopenAction(item.noteId, item.itemId) : reopenTodo(item.itemId),
    onMutate: (item) =>
      optimistic(qc, mapItems((items) =>
        items.map((i) => (i.itemId === item.itemId ? { ...i, completedAt: null } : i)))),
    onError: (_e, _item, ctx) => rollback(qc, ctx),
    onSettled: (_d, _e, item) => settleAction(qc, item),
  });
}

// Reorder the open items into the given full id order. Optimistic: arrange the open items in the
// cache to match immediately; done items (and any open item not in the order) keep their place at
// the end. Reconcile on error. The mutation input is the complete ordered list of open item ids.
function applyOrder(items: TodoItem[], orderedItemIds: string[]): TodoItem[] {
  const byId = new Map(items.map((i) => [i.itemId, i]));
  const ordered = orderedItemIds.map((id) => byId.get(id)).filter((i): i is TodoItem => i !== undefined);
  const orderedIds = new Set(orderedItemIds);
  const rest = items.filter((i) => !orderedIds.has(i.itemId));
  return [...ordered, ...rest];
}

export function useReorderTodos() {
  const qc = useQueryClient();
  return useMutation<void, Error, string[], Ctx>({
    mutationFn: (orderedItemIds) => reorderTodos(orderedItemIds),
    onMutate: (orderedItemIds) => optimistic(qc, mapItems((items) => applyOrder(items, orderedItemIds))),
    onError: (_e, _ids, ctx) => rollback(qc, ctx),
  });
}

// Move the "Today" line. The anchor is the item the line sits immediately above; null puts it
// below everything. Optimistic so the two groups re-split on release, before the save confirms.
export function useSetTodayLine() {
  const qc = useQueryClient();
  return useMutation<void, Error, string | null, Ctx>({
    mutationFn: (anchorItemId) => setTodayLine(anchorItemId),
    onMutate: (anchorItemId) => optimistic(qc, (data) => ({ ...data, todayLineAnchorItemId: anchorItemId })),
    onError: (_e, _v, ctx) => rollback(qc, ctx),
  });
}

export function useEditTodo() {
  const qc = useQueryClient();
  return useMutation<void, Error, { item: TodoItem; description: string }, Ctx>({
    mutationFn: ({ item, description }) =>
      item.type === "action" ? editAction(item.noteId, item.itemId, description) : editTodo(item.itemId, description),
    onMutate: ({ item, description }) =>
      optimistic(qc, mapItems((items) =>
        items.map((i) => (i.itemId === item.itemId ? { ...i, description } : i)))),
    onError: (_e, _v, ctx) => rollback(qc, ctx),
    onSettled: (_d, _e, { item }) => settleAction(qc, item),
  });
}

export function useDeleteTodo() {
  const qc = useQueryClient();
  return useMutation<void, Error, TodoItem, Ctx>({
    mutationFn: (item) =>
      item.type === "action" ? deleteAction(item.noteId, item.itemId) : deleteTodo(item.itemId),
    onMutate: (item) =>
      optimistic(qc, mapItems((items) => items.filter((i) => i.itemId !== item.itemId))),
    onError: (_e, _item, ctx) => rollback(qc, ctx),
    onSettled: (_d, _e, item) => settleAction(qc, item),
  });
}
