import { request, requestVoid } from './client'

export interface NoteItem {
  noteId: string;
  title: string;
}

export interface LinkedMeeting {
  calendarEventId: string;
  title: string;
  startTime: string;
  endTime: string;
  recurringSeriesId: string | null;
  isRecurring: boolean;
}

export interface TranscriptionDraft {
  text: string;
  capturedAt: string;
}

export interface NoteDetail {
  noteId: string;
  title: string;
  content: string;
  date: string | null;
  tags: string[];
  transcriptText: string | null;
  // An uncommitted transcript left by an interrupted recording (crash/tab close),
  // surfaced for recovery. Null on the happy path. See ADR 0011 / Phase 18.
  transcriptDraft: TranscriptionDraft | null;
  summary: string | null;
  discussionPoints: string[];
  decisions: string[];
  summaryModelId: string | null;
  summaryPromptVersion: string | null;
  recurringSeriesId: string | null;
  isRecurring: boolean;
  linkedMeeting: LinkedMeeting | null;
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
  lastModifiedAt: string;
  tags: string[];
  folderId: string | null;
}

export interface SearchResult {
  noteId: string;
  title: string;
  snippet: string;
  score: number;
  matchedField: string;
  matchedTerms: string[];
}

export async function searchNotes(q: string): Promise<SearchResult[]> {
  const body = await request<{ items: SearchResult[] }>(
    `/notes/search?q=${encodeURIComponent(q)}`,
  );
  return body.items;
}

export function getNoteDetail(noteId: string): Promise<NoteDetail> {
  return request<NoteDetail>(`/notes/${noteId}`);
}

export function createNote(): Promise<{ noteId: string }> {
  return request<{ noteId: string }>(`/notes`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "null",
  });
}

export function renameNote(noteId: string, title: string): Promise<void> {
  return requestVoid(`/notes/${noteId}/title`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title }),
  });
}

export function editContent(noteId: string, content: string): Promise<void> {
  return requestVoid(`/notes/${noteId}/content`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content }),
  });
}

export async function listNotes(): Promise<NoteItem[]> {
  const body = await request<{ items: NoteItem[] }>(`/notes`);
  return body.items;
}

export function setNoteDate(noteId: string, date: string | null): Promise<void> {
  return requestVoid(`/notes/${noteId}/date`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ date }),
  });
}

export function deleteNote(noteId: string): Promise<void> {
  return requestVoid(`/notes/${noteId}`, { method: "DELETE" });
}

export async function getNoteCards(): Promise<NoteCard[]> {
  const body = await request<{ cards: NoteCard[] }>(`/notes/cards`);
  return body.cards;
}

export function analyseNote(noteId: string): Promise<void> {
  return requestVoid(`/notes/${noteId}/analyse`, { method: "POST" });
}
