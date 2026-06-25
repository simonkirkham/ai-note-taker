import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { keys } from "../api/queryKeys";
import {
  createWorkspace,
  renameWorkspace,
  deleteWorkspace,
  type Workspace,
} from "../api/workspaces";

type Ctx = { previous?: Workspace[] };

// Snapshot the workspaces list, apply an optimistic transform, return the snapshot
// for rollback — mirrors useFolderMutations.
async function optimistic(qc: QueryClient, apply: (list: Workspace[]) => Workspace[]): Promise<Ctx> {
  await qc.cancelQueries({ queryKey: keys.workspaces });
  const previous = qc.getQueryData<Workspace[]>(keys.workspaces);
  qc.setQueryData<Workspace[]>(keys.workspaces, (old) => apply(old ?? []));
  return { previous };
}

function rollback(qc: QueryClient, ctx: Ctx | undefined) {
  if (ctx?.previous) qc.setQueryData(keys.workspaces, ctx.previous);
}

function invalidate(qc: QueryClient) {
  return qc.invalidateQueries({ queryKey: keys.workspaces });
}

export function useCreateWorkspace() {
  const qc = useQueryClient();
  return useMutation<{ workspaceId: string }, Error, { name: string; tempId: string }, Ctx>({
    mutationFn: ({ name }) => createWorkspace(name),
    onMutate: ({ name, tempId }) =>
      optimistic(qc, (list) => [...list, { workspaceId: tempId, name, isDefault: false }]),
    onError: (_e, _v, ctx) => rollback(qc, ctx),
    onSettled: () => invalidate(qc),
  });
}

export function useRenameWorkspace() {
  const qc = useQueryClient();
  return useMutation<void, Error, { workspaceId: string; name: string }, Ctx>({
    mutationFn: ({ workspaceId, name }) => renameWorkspace(workspaceId, name),
    onMutate: ({ workspaceId, name }) =>
      optimistic(qc, (list) => list.map((w) => (w.workspaceId === workspaceId ? { ...w, name } : w))),
    onError: (_e, _v, ctx) => rollback(qc, ctx),
    onSettled: () => invalidate(qc),
  });
}

export function useDeleteWorkspace() {
  const qc = useQueryClient();
  // onError rolls back the optimistic removal; the caller inspects the error
  // (WorkspaceNotEmptyError) to show the inline "not empty" message.
  return useMutation<void, Error, { workspaceId: string }, Ctx>({
    mutationFn: ({ workspaceId }) => deleteWorkspace(workspaceId),
    onMutate: ({ workspaceId }) =>
      optimistic(qc, (list) => list.filter((w) => w.workspaceId !== workspaceId)),
    onError: (_e, _v, ctx) => rollback(qc, ctx),
    onSettled: () => invalidate(qc),
  });
}
