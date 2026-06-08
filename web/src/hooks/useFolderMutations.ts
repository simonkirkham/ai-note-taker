import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import {
  createFolder,
  renameFolder,
  deleteFolder,
  moveFolder,
  type FolderNode,
} from "../api/folders";
import { keys } from "../api/queryKeys";
import { mapTree, removeFromTree, insertIntoTree, findNode } from "../folderTree";

type Ctx = { previous?: FolderNode[] };

// Snapshot the folders cache, apply an optimistic tree transform, return the
// snapshot for rollback. Mirrors the 20-A todos template.
async function optimistic(
  qc: QueryClient,
  apply: (tree: FolderNode[]) => FolderNode[],
): Promise<Ctx> {
  await qc.cancelQueries({ queryKey: keys.folders });
  const previous = qc.getQueryData<FolderNode[]>(keys.folders);
  qc.setQueryData<FolderNode[]>(keys.folders, (old) => apply(old ?? []));
  return { previous };
}

function rollback(qc: QueryClient, ctx: Ctx | undefined) {
  if (ctx?.previous) qc.setQueryData(keys.folders, ctx.previous);
}

// Unlike todos (single consumer), folders has multiple readers (sidebar tree,
// folder picker) AND create returns a server id the optimistic temp id must be
// swapped for — so every mutation reconciles via invalidateQueries on settle.
function invalidate(qc: QueryClient) {
  return qc.invalidateQueries({ queryKey: keys.folders });
}

export function useCreateFolder() {
  const qc = useQueryClient();
  return useMutation<
    { folderId: string },
    Error,
    { name: string; parentFolderId?: string; tempId: string },
    Ctx
  >({
    mutationFn: ({ name, parentFolderId }) => createFolder(name, parentFolderId),
    onMutate: ({ name, parentFolderId, tempId }) =>
      optimistic(qc, (tree) =>
        insertIntoTree(tree, parentFolderId ?? null, { folderId: tempId, name, children: [] })),
    onError: (_e, _v, ctx) => rollback(qc, ctx),
    onSettled: () => invalidate(qc),
  });
}

export function useRenameFolder() {
  const qc = useQueryClient();
  return useMutation<void, Error, { folderId: string; name: string }, Ctx>({
    mutationFn: ({ folderId, name }) => renameFolder(folderId, name),
    onMutate: ({ folderId, name }) =>
      optimistic(qc, (tree) => mapTree(tree, folderId, (n) => ({ ...n, name }))),
    onError: (_e, _v, ctx) => rollback(qc, ctx),
    onSettled: () => invalidate(qc),
  });
}

export function useDeleteFolder() {
  const qc = useQueryClient();
  return useMutation<void, Error, { folderId: string }, Ctx>({
    mutationFn: ({ folderId }) => deleteFolder(folderId),
    onMutate: ({ folderId }) => optimistic(qc, (tree) => removeFromTree(tree, folderId)),
    onError: (_e, _v, ctx) => rollback(qc, ctx),
    onSettled: () => invalidate(qc),
  });
}

export function useMoveFolder() {
  const qc = useQueryClient();
  return useMutation<void, Error, { folderId: string; parentFolderId: string | null }, Ctx>({
    mutationFn: ({ folderId, parentFolderId }) => moveFolder(folderId, parentFolderId),
    onMutate: ({ folderId, parentFolderId }) =>
      optimistic(qc, (tree) => {
        const node = findNode(tree, folderId);
        if (!node) return tree;
        return insertIntoTree(removeFromTree(tree, folderId), parentFolderId, node);
      }),
    onError: (_e, _v, ctx) => rollback(qc, ctx),
    onSettled: () => invalidate(qc),
  });
}
