import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import {
  addAction,
  completeAction,
  reopenAction,
  deleteAction,
  type ActionItem,
} from "../api/actions";
import type { NoteCard, NoteDetail } from "../api/notes";
import { keys } from "../api/queryKeys";
import type { TodoItem } from "../api/todos";

type Ctx = { previous?: ActionItem[]; previousTodos?: TodoItem[] };

// Snapshot a note's actions cache, apply an optimistic transform, return the
// snapshot for rollback. Mirrors the 20-A/20-B template.
async function snapshotActions(
  qc: QueryClient,
  noteId: string,
  apply: (items: ActionItem[]) => ActionItem[],
): Promise<{ previous?: ActionItem[] }> {
  const key = keys.actions(noteId);
  await qc.cancelQueries({ queryKey: key });
  const previous = qc.getQueryData<ActionItem[]>(key);
  qc.setQueryData<ActionItem[]>(key, (old) => apply(old ?? []));
  return { previous };
}

// The home to-do list (keys.todos) surfaces actions as todos (20-A). Under the async
// projector (27-C) it lags a write, so an eager invalidate refetched a stale list and
// stuck (27-C2). Instead each action mutation patches keys.todos optimistically (an
// action appears there as a TodoItem of type "action") and rolls back on error — no
// racing refetch. patchTodos is a no-op when keys.todos isn't cached (home not yet
// visited); the list is fetched fresh on first visit, by then caught up.
async function snapshotTodos(
  qc: QueryClient,
  apply: (items: TodoItem[]) => TodoItem[],
): Promise<{ previousTodos?: TodoItem[] }> {
  await qc.cancelQueries({ queryKey: keys.todos });
  const previousTodos = qc.getQueryData<TodoItem[]>(keys.todos);
  if (previousTodos === undefined) return {};
  qc.setQueryData<TodoItem[]>(keys.todos, apply(previousTodos));
  return { previousTodos };
}

function rollback(qc: QueryClient, noteId: string, ctx: Ctx | undefined) {
  if (ctx?.previous) qc.setQueryData(keys.actions(noteId), ctx.previous);
  if (ctx?.previousTodos) qc.setQueryData(keys.todos, ctx.previousTodos);
}

// The note's title for the optimistic todo row — read from whichever cache holds it
// (note detail is cached while its Actions section is open; fall back to the card).
function noteTitle(qc: QueryClient, noteId: string): string | null {
  const detail = qc.getQueryData<NoteDetail>(keys.note(noteId));
  if (detail) return detail.title;
  const card = qc.getQueryData<NoteCard[]>(keys.noteCards)?.find((c) => c.noteId === noteId);
  return card ? card.title : null;
}

function patchCardActions(qc: QueryClient, noteId: string, apply: (actions: NoteCard["openActions"]) => NoteCard["openActions"]) {
  const previous = qc.getQueryData<NoteCard[]>(keys.noteCards);
  if (previous === undefined) return;
  qc.setQueryData<NoteCard[]>(keys.noteCards, previous.map((c) =>
    c.noteId === noteId ? { ...c, openActions: apply(c.openActions) } : c));
}

export function useAddAction(noteId: string) {
  const qc = useQueryClient();
  return useMutation<{ actionId: string }, Error, { description: string; tempId: string }, Ctx>({
    mutationFn: ({ description }) => addAction(noteId, description),
    onMutate: async ({ description, tempId }) => {
      const addedAt = new Date().toISOString();
      const actionsCtx = await snapshotActions(qc, noteId, (items) => [
        ...items,
        { actionId: tempId, description, completed: false, addedAt, completedAt: null },
      ]);
      const todosCtx = await snapshotTodos(qc, (items) => [
        ...items,
        {
          itemId: tempId, type: "action", noteId, noteTitle: noteTitle(qc, noteId),
          description, addedAt, completedAt: null,
        },
      ]);
      patchCardActions(qc, noteId, (actions) => [...actions, { actionId: tempId, description }]);
      return { ...actionsCtx, ...todosCtx };
    },
    onError: (_e, _v, ctx) => rollback(qc, noteId, ctx),
    // addAction returns the server id — swap the optimistic temp id for it in every
    // cache that holds the row, rather than invalidating keys.actions and racing the
    // lagging projector (27-C2).
    onSuccess: ({ actionId }, { tempId }) => {
      qc.setQueryData<ActionItem[]>(keys.actions(noteId), (items) =>
        (items ?? []).map((a) => (a.actionId === tempId ? { ...a, actionId } : a)));
      qc.setQueryData<TodoItem[]>(keys.todos, (items) =>
        items?.map((i) => (i.itemId === tempId ? { ...i, itemId: actionId } : i)));
      patchCardActions(qc, noteId, (actions) =>
        actions.map((a) => (a.actionId === tempId ? { ...a, actionId } : a)));
    },
  });
}

export function useCompleteAction(noteId: string) {
  const qc = useQueryClient();
  return useMutation<void, Error, string, Ctx>({
    mutationFn: (actionId) => completeAction(noteId, actionId),
    onMutate: async (actionId) => {
      const completedAt = new Date().toISOString();
      const actionsCtx = await snapshotActions(qc, noteId, (items) =>
        items.map((a) => (a.actionId === actionId ? { ...a, completed: true, completedAt } : a)));
      const todosCtx = await snapshotTodos(qc, (items) =>
        items.map((i) => (i.itemId === actionId ? { ...i, completedAt } : i)));
      // A completed action drops out of the card's open-actions list.
      patchCardActions(qc, noteId, (actions) => actions.filter((a) => a.actionId !== actionId));
      return { ...actionsCtx, ...todosCtx };
    },
    onError: (_e, _id, ctx) => rollback(qc, noteId, ctx),
  });
}

export function useReopenAction(noteId: string) {
  const qc = useQueryClient();
  return useMutation<void, Error, string, Ctx>({
    mutationFn: (actionId) => reopenAction(noteId, actionId),
    onMutate: async (actionId) => {
      // Read the reopened action's description before the snapshot transform, so the
      // card patch can re-add it to the card's open-actions list.
      const description = qc
        .getQueryData<ActionItem[]>(keys.actions(noteId))
        ?.find((a) => a.actionId === actionId)?.description;
      const actionsCtx = await snapshotActions(qc, noteId, (items) =>
        items.map((a) => (a.actionId === actionId ? { ...a, completed: false, completedAt: null } : a)));
      const todosCtx = await snapshotTodos(qc, (items) =>
        items.map((i) => (i.itemId === actionId ? { ...i, completedAt: null } : i)));
      // A reopened action re-enters the card's open-actions list (the inverse of
      // complete, which filters it out). Skip if its description is unknown or it is
      // already present.
      if (description !== undefined) {
        patchCardActions(qc, noteId, (actions) =>
          actions.some((a) => a.actionId === actionId)
            ? actions
            : [...actions, { actionId, description }]);
      }
      return { ...actionsCtx, ...todosCtx };
    },
    onError: (_e, _id, ctx) => rollback(qc, noteId, ctx),
  });
}

export function useDeleteAction(noteId: string) {
  const qc = useQueryClient();
  return useMutation<void, Error, string, Ctx>({
    mutationFn: (actionId) => deleteAction(noteId, actionId),
    onMutate: async (actionId) => {
      const actionsCtx = await snapshotActions(qc, noteId, (items) =>
        items.filter((a) => a.actionId !== actionId));
      const todosCtx = await snapshotTodos(qc, (items) =>
        items.filter((i) => i.itemId !== actionId));
      patchCardActions(qc, noteId, (actions) => actions.filter((a) => a.actionId !== actionId));
      return { ...actionsCtx, ...todosCtx };
    },
    onError: (_e, _id, ctx) => rollback(qc, noteId, ctx),
  });
}
