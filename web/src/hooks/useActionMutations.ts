import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import {
  addAction,
  completeAction,
  reopenAction,
  deleteAction,
  type ActionItem,
} from "../api/actions";
import { keys } from "../api/queryKeys";

type Ctx = { previous?: ActionItem[] };

// Snapshot a note's actions cache, apply an optimistic transform, return the
// snapshot for rollback. Mirrors the 20-A/20-B template.
async function optimistic(
  qc: QueryClient,
  noteId: string,
  apply: (items: ActionItem[]) => ActionItem[],
): Promise<Ctx> {
  const key = keys.actions(noteId);
  await qc.cancelQueries({ queryKey: key });
  const previous = qc.getQueryData<ActionItem[]>(key);
  qc.setQueryData<ActionItem[]>(key, (old) => apply(old ?? []));
  return { previous };
}

function rollback(qc: QueryClient, noteId: string, ctx: Ctx | undefined) {
  if (ctx?.previous) qc.setQueryData(keys.actions(noteId), ctx.previous);
}

// keys.actions(noteId) has a single consumer (this section), so complete/reopen/
// delete need no self-reconcile (optimistic == server). They DO invalidate
// keys.todos — the home to-do list surfaces actions (20-A). Only `add` also
// invalidates keys.actions, to swap its optimistic temp id for the server id.
function invalidateTodos(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: keys.todos });
}

function invalidateActionsAndTodos(qc: QueryClient, noteId: string) {
  void qc.invalidateQueries({ queryKey: keys.actions(noteId) });
  invalidateTodos(qc);
}

export function useAddAction(noteId: string) {
  const qc = useQueryClient();
  return useMutation<{ actionId: string }, Error, { description: string; tempId: string }, Ctx>({
    mutationFn: ({ description }) => addAction(noteId, description),
    onMutate: ({ description, tempId }) =>
      optimistic(qc, noteId, (items) => [
        ...items,
        { actionId: tempId, description, completed: false, addedAt: new Date().toISOString(), completedAt: null },
      ]),
    onError: (_e, _v, ctx) => rollback(qc, noteId, ctx),
    onSettled: () => invalidateActionsAndTodos(qc, noteId),
  });
}

export function useCompleteAction(noteId: string) {
  const qc = useQueryClient();
  return useMutation<void, Error, string, Ctx>({
    mutationFn: (actionId) => completeAction(noteId, actionId),
    onMutate: (actionId) =>
      optimistic(qc, noteId, (items) =>
        items.map((a) =>
          a.actionId === actionId ? { ...a, completed: true, completedAt: new Date().toISOString() } : a)),
    onError: (_e, _id, ctx) => rollback(qc, noteId, ctx),
    onSettled: () => invalidateTodos(qc),
  });
}

export function useReopenAction(noteId: string) {
  const qc = useQueryClient();
  return useMutation<void, Error, string, Ctx>({
    mutationFn: (actionId) => reopenAction(noteId, actionId),
    onMutate: (actionId) =>
      optimistic(qc, noteId, (items) =>
        items.map((a) => (a.actionId === actionId ? { ...a, completed: false, completedAt: null } : a))),
    onError: (_e, _id, ctx) => rollback(qc, noteId, ctx),
    onSettled: () => invalidateTodos(qc),
  });
}

export function useDeleteAction(noteId: string) {
  const qc = useQueryClient();
  return useMutation<void, Error, string, Ctx>({
    mutationFn: (actionId) => deleteAction(noteId, actionId),
    onMutate: (actionId) =>
      optimistic(qc, noteId, (items) => items.filter((a) => a.actionId !== actionId)),
    onError: (_e, _id, ctx) => rollback(qc, noteId, ctx),
    onSettled: () => invalidateTodos(qc),
  });
}
