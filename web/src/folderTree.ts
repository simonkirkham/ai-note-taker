import type { FolderNode } from "./api/folders";

// Pure helpers for optimistic edits to the folder tree held in the TanStack
// Query cache (keys.folders). Shared by App.tsx (deriving UI) and the folder
// mutation hooks (optimistic onMutate transforms).

export function mapTree(
  nodes: FolderNode[],
  folderId: string,
  update: (n: FolderNode) => FolderNode,
): FolderNode[] {
  return nodes.map((n) =>
    n.folderId === folderId
      ? update(n)
      : { ...n, children: mapTree(n.children ?? [], folderId, update) },
  );
}

export function removeFromTree(nodes: FolderNode[], folderId: string): FolderNode[] {
  return nodes
    .filter((n) => n.folderId !== folderId)
    .map((n) => ({ ...n, children: removeFromTree(n.children ?? [], folderId) }));
}

// Append a node under parentFolderId, or at the root when parentFolderId is null.
export function insertIntoTree(
  nodes: FolderNode[],
  parentFolderId: string | null,
  node: FolderNode,
): FolderNode[] {
  if (parentFolderId === null) return [...nodes, node];
  return mapTree(nodes, parentFolderId, (n) => ({
    ...n,
    children: [...(n.children ?? []), node],
  }));
}

export function findNode(nodes: FolderNode[], folderId: string): FolderNode | undefined {
  for (const n of nodes) {
    if (n.folderId === folderId) return n;
    const found = findNode(n.children ?? [], folderId);
    if (found) return found;
  }
  return undefined;
}

// Breadcrumb of folder names from the root down to folderId (inclusive), or
// undefined if the id is not in the tree. Used to derive the heading for a
// folder URL — a sub-folder rebuilds its full ancestor path, not just its leaf.
export function findPath(nodes: FolderNode[], folderId: string): string[] | undefined {
  for (const n of nodes) {
    if (n.folderId === folderId) return [n.name];
    const sub = findPath(n.children ?? [], folderId);
    if (sub) return [n.name, ...sub];
  }
  return undefined;
}
