import { requestVoidWithResponse, requestWithResponse } from './client'
import { clearLatestToken, getLatestToken, setLatestToken } from './consistencyTokens'
import { gatedRead } from './gatedRead'
import { captureNoteToken, NOTE_CARDS_SCOPE } from './notes'

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
  // BUG-46: the delete also cascades an `UnfileNote` NOTE-stream write per contained note, and
  // `useDeleteFolder` refetches the cards list afterwards. Without this the cards read is ungated
  // w.r.t. those writes and can still show the notes under the folder that just went away. The
  // cards gate holds one stream token (design #7), so the server returns the LAST unfile write's.
  const notesToken = response.headers.get('X-Consistency-Token-NoteCards')
  if (notesToken) setLatestToken(NOTE_CARDS_SCOPE, notesToken)
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
// note stream, surfaced via the note card. BUG-45: these are cards-list writes — capture the write
// token via `captureNoteToken` (the note-cards scope) so `useMoveNote*`'s onSettled cards refetch
// gates on the projector applying the move; else the moved note reappears in the source list.
export async function moveNoteToFolder(noteId: string, folderId: string): Promise<void> {
  const response = await requestVoidWithResponse(`/notes/${noteId}/folder`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ folderId }),
  })
  captureNoteToken(noteId, response)
}

export async function unfileNote(noteId: string): Promise<void> {
  const response = await requestVoidWithResponse(`/notes/${noteId}/folder`, { method: "DELETE" })
  captureNoteToken(noteId, response)
}

export async function moveNoteToWorkspace(noteId: string, workspaceId: string): Promise<void> {
  const response = await requestVoidWithResponse(`/notes/${noteId}/workspace`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ workspaceId }),
  })
  captureNoteToken(noteId, response)
}
