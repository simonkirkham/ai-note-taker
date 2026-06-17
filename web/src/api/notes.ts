import { request, requestVoid, requestVoidWithResponse, requestWithResponse } from './client';
import {
  clearLatestToken,
  clearStreamToken,
  getLatestToken,
  getStreamToken,
  setLatestToken,
  setStreamToken,
} from './consistencyTokens';
import { gatedRead } from './gatedRead';

// Read-your-writes (RYW-2): the note flows are async (the projector builds the read models). A
// note write returns its write token in `X-Consistency-Token`; the next note read echoes it in
// `If-Consistent-With` so the server waits until the projector applied the write. A single-note
// read (GET /notes/{id}) waits on that note's own stream; the cards LIST read waits on the most
// recently written note (the one the user just edited).
const NOTE_CARDS_SCOPE = 'noteCards';

function noteStream(noteId: string): string {
  return `note#${noteId}`;
}

// Record a note write's token both against its own stream (for the note-detail read) and as the
// latest note write (for the cards-list read). Exported so tag writes (a note-aggregate flow in
// a sibling module) reuse the same capture. A missing header (e.g. a 404/409 no-op) is a no-op.
export function captureNoteToken(noteId: string, response: Response): void {
  const token = response.headers.get('X-Consistency-Token');
  if (!token) return;
  setStreamToken(noteStream(noteId), token);
  setLatestToken(NOTE_CARDS_SCOPE, token);
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

export interface InstructionResponse {
  instruction: string;
  response: string;
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
  // AI responses to inline `/ai` instructions the user wrote in their notes (Phase 29).
  instructionResponses: InstructionResponse[];
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
  const body = await request<{ items: SearchResult[] }>(`/notes/search?q=${encodeURIComponent(q)}`);
  return body.items;
}

export function getNoteDetail(noteId: string): Promise<NoteDetail> {
  const stream = noteStream(noteId);
  return gatedRead<NoteDetail>(`/notes/${noteId}`, getStreamToken(stream), () => clearStreamToken(stream));
}

export async function createNote(): Promise<{ noteId: string }> {
  const { body, response } = await requestWithResponse<{ noteId: string }>(`/notes`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: 'null',
  });
  captureNoteToken(body.noteId, response);
  return body;
}

export async function renameNote(noteId: string, title: string): Promise<void> {
  const response = await requestVoidWithResponse(`/notes/${noteId}/title`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title }),
  });
  captureNoteToken(noteId, response);
}

export async function editContent(noteId: string, content: string): Promise<void> {
  const response = await requestVoidWithResponse(`/notes/${noteId}/content`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content }),
  });
  captureNoteToken(noteId, response);
}

export async function setNoteDate(noteId: string, date: string | null): Promise<void> {
  const response = await requestVoidWithResponse(`/notes/${noteId}/date`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ date }),
  });
  captureNoteToken(noteId, response);
}

export function deleteNote(noteId: string): Promise<void> {
  return requestVoid(`/notes/${noteId}`, { method: 'DELETE' });
}

export async function getNoteCards(): Promise<NoteCard[]> {
  const body = await gatedRead<{ cards: NoteCard[] }>(
    `/notes/cards`,
    getLatestToken(NOTE_CARDS_SCOPE),
    () => clearLatestToken(NOTE_CARDS_SCOPE),
  );
  return body.cards;
}

export function analyseNote(noteId: string): Promise<void> {
  return requestVoid(`/notes/${noteId}/analyse`, { method: 'POST' });
}

export interface PresignUploadResult {
  imageId: string;
  key: string;
  uploadUrl: string;
  contentType: string;
}

export function presignUpload(
  noteId: string,
  body: { contentType: string; contentLength: number }
): Promise<PresignUploadResult> {
  return request<PresignUploadResult>(`/notes/${noteId}/images/presign-upload`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function resolveImages(
  noteId: string,
  keys: string[]
): Promise<Record<string, string>> {
  if (keys.length === 0) return {};
  const body = await request<{ urls: Record<string, string> }>(`/notes/${noteId}/images/resolve`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ keys }),
  });
  return body.urls;
}
