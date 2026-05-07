const base = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");

export interface NoteItem {
  noteId: string;
  title: string;
}

export interface NoteDetail {
  noteId: string;
  title: string;
  content: string;
}

export async function getNoteDetail(noteId: string): Promise<NoteDetail> {
  const res = await fetch(`${base}/notes/${noteId}`);
  if (!res.ok) throw new Error(`GET /notes/${noteId} failed: ${res.status}`);
  return res.json();
}

export async function createNote(): Promise<{ noteId: string }> {
  const res = await fetch(`${base}/notes`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "null",
  });
  if (!res.ok) throw new Error(`POST /notes failed: ${res.status}`);
  return res.json();
}

export async function renameNote(noteId: string, title: string): Promise<void> {
  const res = await fetch(`${base}/notes/${noteId}/title`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title }),
  });
  if (!res.ok)
    throw new Error(`PATCH /notes/${noteId}/title failed: ${res.status}`);
}

export async function editContent(noteId: string, content: string): Promise<void> {
  const res = await fetch(`${base}/notes/${noteId}/content`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content }),
  });
  if (!res.ok)
    throw new Error(`PUT /notes/${noteId}/content failed: ${res.status}`);
}

export async function listNotes(): Promise<NoteItem[]> {
  const res = await fetch(`${base}/notes`);
  if (!res.ok) throw new Error(`GET /notes failed: ${res.status}`);
  const body: { items: NoteItem[] } = await res.json();
  return body.items;
}

export async function deleteNote(noteId: string): Promise<void> {
  const res = await fetch(`${base}/notes/${noteId}`, { method: "DELETE" });
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
  const res = await fetch(`${base}/notes/${noteId}/actions`);
  if (!res.ok) throw new Error(`GET /notes/${noteId}/actions failed: ${res.status}`);
  const body: { actions: ActionItem[] } = await res.json();
  return body.actions;
}

export async function addAction(noteId: string, description: string): Promise<{ actionId: string }> {
  const res = await fetch(`${base}/notes/${noteId}/actions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ description }),
  });
  if (!res.ok) throw new Error(`POST /notes/${noteId}/actions failed: ${res.status}`);
  return res.json();
}

export async function completeAction(noteId: string, actionId: string): Promise<void> {
  const res = await fetch(`${base}/notes/${noteId}/actions/${actionId}/complete`, { method: "POST" });
  if (!res.ok) throw new Error(`POST /notes/${noteId}/actions/${actionId}/complete failed: ${res.status}`);
}

export async function reopenAction(noteId: string, actionId: string): Promise<void> {
  const res = await fetch(`${base}/notes/${noteId}/actions/${actionId}/reopen`, { method: "POST" });
  if (!res.ok) throw new Error(`POST /notes/${noteId}/actions/${actionId}/reopen failed: ${res.status}`);
}

export interface TodoItem {
  actionId: string;
  noteId: string;
  noteTitle: string;
  description: string;
  addedAt: string;
}

export async function getTodos(): Promise<TodoItem[]> {
  const res = await fetch(`${base}/todos`);
  if (!res.ok) throw new Error(`GET /todos failed: ${res.status}`);
  const body: { items: TodoItem[] } = await res.json();
  return body.items;
}
