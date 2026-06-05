import { request, requestVoid } from './client'

export interface FolderNode {
  folderId: string;
  name: string;
  children: FolderNode[];
}

export async function getFolders(): Promise<FolderNode[]> {
  const body = await request<{ folders: FolderNode[] }>(`/folders`);
  return body.folders;
}

export function createFolder(name: string, parentFolderId?: string): Promise<{ folderId: string }> {
  return request<{ folderId: string }>(`/folders`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, parentFolderId: parentFolderId ?? null }),
  });
}

export function renameFolder(folderId: string, name: string): Promise<void> {
  return requestVoid(`/folders/${folderId}/name`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name }),
  });
}

export function deleteFolder(folderId: string): Promise<void> {
  return requestVoid(`/folders/${folderId}`, { method: "DELETE" });
}

export function moveNoteToFolder(noteId: string, folderId: string): Promise<void> {
  return requestVoid(`/notes/${noteId}/folder`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ folderId }),
  });
}

export function unfileNote(noteId: string): Promise<void> {
  return requestVoid(`/notes/${noteId}/folder`, { method: "DELETE" });
}

export function moveFolder(folderId: string, parentFolderId: string | null): Promise<void> {
  return requestVoid(`/folders/${folderId}/parent`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ parentFolderId }),
  });
}
