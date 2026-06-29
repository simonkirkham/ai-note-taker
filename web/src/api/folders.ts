import { requestVoid, requestVoidWithResponse, requestWithResponse } from './client'
import { clearLatestToken, getLatestToken, setLatestToken } from './consistencyTokens'
import { gatedRead } from './gatedRead'

// Read-your-writes (RYW-3b): the folder flows are async (the projector builds the folder tree). A
// folder write returns its write token in `X-Consistency-Token`; the next `GET /folders` echoes it
// in `If-Consistent-With` so the server waits until the projector applied the write. The folders
// read is a LIST built from many folder streams, so it waits on the single stream the user most
// recently wrote (design decision #7).
const FOLDERS_SCOPE = 'folders'

function captureFolderToken(response: Response): void {
  const token = response.headers.get('X-Consistency-Token')
  if (!token) return
  setLatestToken(FOLDERS_SCOPE, token)
}

export interface FolderNode {
  folderId: string;
  name: string;
  children: FolderNode[];
}

export function getFolders(): Promise<FolderNode[]> {
  return gatedRead<{ folders: FolderNode[] }>(
    `/folders`,
    getLatestToken(FOLDERS_SCOPE),
    () => clearLatestToken(FOLDERS_SCOPE),
  ).then((body) => body.folders)
}

export async function createFolder(name: string, parentFolderId?: string): Promise<{ folderId: string }> {
  const { body, response } = await requestWithResponse<{ folderId: string }>(`/folders`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, parentFolderId: parentFolderId ?? null }),
  })
  captureFolderToken(response)
  return body
}

export async function renameFolder(folderId: string, name: string): Promise<void> {
  const response = await requestVoidWithResponse(`/folders/${folderId}/name`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name }),
  })
  captureFolderToken(response)
}

export async function deleteFolder(folderId: string): Promise<void> {
  const response = await requestVoidWithResponse(`/folders/${folderId}`, { method: "DELETE" })
  captureFolderToken(response)
}

export async function moveFolder(folderId: string, parentFolderId: string | null): Promise<void> {
  const response = await requestVoidWithResponse(`/folders/${folderId}/parent`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ parentFolderId }),
  })
  captureFolderToken(response)
}

// Note-aggregate flows (not the folder tree): a note's folder/workspace assignment lives on the
// note stream, surfaced via the note card — unchanged by RYW-3b.
export function moveNoteToFolder(noteId: string, folderId: string): Promise<void> {
  return requestVoid(`/notes/${noteId}/folder`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ folderId }),
  })
}

export function unfileNote(noteId: string): Promise<void> {
  return requestVoid(`/notes/${noteId}/folder`, { method: "DELETE" })
}

export function moveNoteToWorkspace(noteId: string, workspaceId: string): Promise<void> {
  return requestVoid(`/notes/${noteId}/workspace`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ workspaceId }),
  })
}
