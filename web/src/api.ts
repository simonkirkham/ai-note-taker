import { getToken } from './auth/tokenStore'

const base = "/api";

function apiFetch(url: string, init?: RequestInit): Promise<Response> {
  const token = getToken()
  const headers = new Headers(init?.headers)
  if (token) headers.set('Authorization', `Bearer ${token}`)
  return fetch(url, { ...init, headers })
}

export interface NoteItem {
  noteId: string;
  title: string;
}

export interface NoteDetail {
  noteId: string;
  title: string;
  content: string;
  date: string | null;
  tags: string[];
}

export async function getNoteDetail(noteId: string): Promise<NoteDetail> {
  const res = await apiFetch(`${base}/notes/${noteId}`);
  if (!res.ok) throw new Error(`GET /notes/${noteId} failed: ${res.status}`);
  return res.json();
}

export async function createNote(): Promise<{ noteId: string }> {
  const res = await apiFetch(`${base}/notes`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "null",
  });
  if (!res.ok) throw new Error(`POST /notes failed: ${res.status}`);
  return res.json();
}

export async function renameNote(noteId: string, title: string): Promise<void> {
  const res = await apiFetch(`${base}/notes/${noteId}/title`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title }),
  });
  if (!res.ok)
    throw new Error(`PATCH /notes/${noteId}/title failed: ${res.status}`);
}

export async function editContent(noteId: string, content: string): Promise<void> {
  const res = await apiFetch(`${base}/notes/${noteId}/content`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content }),
  });
  if (!res.ok)
    throw new Error(`PUT /notes/${noteId}/content failed: ${res.status}`);
}

export async function listNotes(): Promise<NoteItem[]> {
  const res = await apiFetch(`${base}/notes`);
  if (!res.ok) throw new Error(`GET /notes failed: ${res.status}`);
  const body: { items: NoteItem[] } = await res.json();
  return body.items;
}

export async function setNoteDate(noteId: string, date: string | null): Promise<void> {
  const res = await apiFetch(`${base}/notes/${noteId}/date`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ date }),
  });
  if (!res.ok) throw new Error(`PATCH /notes/${noteId}/date failed: ${res.status}`);
}

export async function deleteNote(noteId: string): Promise<void> {
  const res = await apiFetch(`${base}/notes/${noteId}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`DELETE /notes/${noteId} failed: ${res.status}`);
}

export interface ActionItem {
  actionId: string;
  description: string;
  completed: boolean;
  addedAt: string;
  completedAt: string | null;
}

export async function getActions(noteId: string): Promise<ActionItem[]> {
  const res = await apiFetch(`${base}/notes/${noteId}/actions`);
  if (!res.ok) throw new Error(`GET /notes/${noteId}/actions failed: ${res.status}`);
  const body: { actions: ActionItem[] } = await res.json();
  return body.actions;
}

export async function addAction(noteId: string, description: string): Promise<{ actionId: string }> {
  const res = await apiFetch(`${base}/notes/${noteId}/actions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ description }),
  });
  if (!res.ok) throw new Error(`POST /notes/${noteId}/actions failed: ${res.status}`);
  return res.json();
}

export async function completeAction(noteId: string, actionId: string): Promise<void> {
  const res = await apiFetch(`${base}/notes/${noteId}/actions/${actionId}/complete`, { method: "POST" });
  if (!res.ok) throw new Error(`POST /notes/${noteId}/actions/${actionId}/complete failed: ${res.status}`);
}

export async function reopenAction(noteId: string, actionId: string): Promise<void> {
  const res = await apiFetch(`${base}/notes/${noteId}/actions/${actionId}/reopen`, { method: "POST" });
  if (!res.ok) throw new Error(`POST /notes/${noteId}/actions/${actionId}/reopen failed: ${res.status}`);
}

export async function deleteAction(noteId: string, actionId: string): Promise<void> {
  const res = await apiFetch(`${base}/notes/${noteId}/actions/${actionId}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`DELETE /notes/${noteId}/actions/${actionId} failed: ${res.status}`);
}

export interface NoteCardAction {
  actionId: string;
  description: string;
}

export interface NoteCard {
  noteId: string;
  title: string;
  contentPreview: string;
  date: string | null;
  openActions: NoteCardAction[];
  createdAt: string;
  tags: string[];
  folderId: string | null;
}

export async function getNoteCards(): Promise<NoteCard[]> {
  const res = await apiFetch(`${base}/notes/cards`);
  if (!res.ok) throw new Error(`GET /notes/cards failed: ${res.status}`);
  const body: { cards: NoteCard[] } = await res.json();
  return body.cards;
}

export async function tagNote(noteId: string, tag: string): Promise<void> {
  const res = await apiFetch(`${base}/notes/${noteId}/tags`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tag }),
  });
  if (!res.ok && res.status !== 409) throw new Error(`POST /notes/${noteId}/tags failed: ${res.status}`);
}

export async function untagNote(noteId: string, tag: string): Promise<void> {
  const res = await apiFetch(`${base}/notes/${noteId}/tags/${encodeURIComponent(tag)}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`DELETE /notes/${noteId}/tags/${tag} failed: ${res.status}`);
}

export interface TagIndexEntry {
  tag: string;
  noteCount: number;
  noteIds: string[];
}

export async function getTags(): Promise<TagIndexEntry[]> {
  const res = await apiFetch(`${base}/tags`);
  if (!res.ok) throw new Error(`GET /tags failed: ${res.status}`);
  const body: { tags: TagIndexEntry[] } = await res.json();
  return body.tags;
}

export interface FolderNode {
  folderId: string;
  name: string;
  children: FolderNode[];
}

export async function getFolders(): Promise<FolderNode[]> {
  const res = await apiFetch(`${base}/folders`);
  if (!res.ok) throw new Error(`GET /folders failed: ${res.status}`);
  const body: { folders: FolderNode[] } = await res.json();
  return body.folders;
}

export async function createFolder(name: string, parentFolderId?: string): Promise<{ folderId: string }> {
  const res = await apiFetch(`${base}/folders`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, parentFolderId: parentFolderId ?? null }),
  });
  if (!res.ok) throw new Error(`POST /folders failed: ${res.status}`);
  return res.json();
}

export async function renameFolder(folderId: string, name: string): Promise<void> {
  const res = await apiFetch(`${base}/folders/${folderId}/name`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error(`PATCH /folders/${folderId}/name failed: ${res.status}`);
}

export async function deleteFolder(folderId: string): Promise<void> {
  const res = await apiFetch(`${base}/folders/${folderId}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`DELETE /folders/${folderId} failed: ${res.status}`);
}

export async function moveNoteToFolder(noteId: string, folderId: string): Promise<void> {
  const res = await apiFetch(`${base}/notes/${noteId}/folder`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ folderId }),
  });
  if (!res.ok) throw new Error(`PUT /notes/${noteId}/folder failed: ${res.status}`);
}

export async function unfileNote(noteId: string): Promise<void> {
  const res = await apiFetch(`${base}/notes/${noteId}/folder`, { method: "DELETE" });
  if (!res.ok) throw new Error(`DELETE /notes/${noteId}/folder failed: ${res.status}`);
}

export async function moveFolder(folderId: string, parentFolderId: string | null): Promise<void> {
  const res = await apiFetch(`${base}/folders/${folderId}/parent`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ parentFolderId }),
  });
  if (!res.ok) throw new Error(`PUT /folders/${folderId}/parent failed: ${res.status}`);
}

export interface TodoItem {
  actionId: string;
  noteId: string;
  noteTitle: string;
  description: string;
  addedAt: string;
}

export async function getTodos(): Promise<TodoItem[]> {
  const res = await apiFetch(`${base}/todos`);
  if (!res.ok) throw new Error(`GET /todos failed: ${res.status}`);
  const body: { items: TodoItem[] } = await res.json();
  return body.items;
}
