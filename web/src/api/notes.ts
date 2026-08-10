import { ApiError, request, requestVoid, requestVoidWithResponse, requestWithResponse } from './client';
import {
  clearLatestToken,
  clearStreamToken,
  getLatestToken,
  getStreamToken,
  setLatestToken,
  setStreamToken,
  tokenStream,
} from './consistencyTokens';
import { gatedReadResult, type GatedResult } from './gatedRead';

// Read-your-writes (RYW-2): the note flows are async (the projector builds the read models). A
// note write returns its write token in `X-Consistency-Token`; the next note read echoes it in
// `If-Consistent-With` so the server waits until the projector applied the write. A single-note
// read (GET /notes/{id}) waits on that note's own stream; the cards LIST read waits on the most
// recently written note (the one the user just edited).
export const NOTE_CARDS_SCOPE = 'noteCards';

const NOTE_STREAM_PREFIX = 'note#';

function noteStream(noteId: string): string {
  return `${NOTE_STREAM_PREFIX}${noteId}`;
}

// The note a `<stream>@<version>` token names, or null if the token is absent or names some other
// aggregate. Only note writes ever reach the cards scope, but the cards guard acts on this id, so a
// foreign stream must degrade to "protect nothing" rather than to a bogus note id.
function noteIdFromToken(token: string | null): string | null {
  if (!token) return null;
  const stream = tokenStream(token);
  return stream.startsWith(NOTE_STREAM_PREFIX) ? stream.slice(NOTE_STREAM_PREFIX.length) : null;
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

// A meeting agenda item (Phase 43): a topic to discuss, stored separately from the free-form note
// body. `discussed` is always false until 43-B adds tick/untick. `position` is capture order.
export interface AgendaItem {
  itemId: string;
  text: string;
  discussed: boolean;
  position: number;
  // 43-H2: always true — every topic is read out of the note body (a task-list line), and the
  // header's add/tick/reword/remove are edits to that line. Retained as a wire field because the
  // server still sends it; it no longer selects between two paths.
  derived?: boolean;
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
  // The S3 key of the saved call recording (Phase 33-A), or null if none was
  // captured. Presence drives the "Download recording" link; the URL itself is
  // fetched lazily via POST /recording/presign-download on click.
  recordingAudioKey: string | null;
  // True once the batch-diarization job has replaced the streamed transcript with the
  // speaker-labelled one (Phase 33-B1). Drives the "Refining transcript…" chip: the frontend
  // polls this flag after triggering diarization and clears the chip when it flips true.
  transcriptIsDiarized: boolean;
  summary: string | null;
  discussionPoints: string[];
  decisions: string[];
  // AI responses to inline `/ai` instructions the user wrote in their notes (Phase 29).
  instructionResponses: InstructionResponse[];
  summaryModelId: string | null;
  summaryPromptVersion: string | null;
  // The meeting agenda — topics to discuss, in capture order (Phase 43).
  agenda: AgendaItem[];
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

// Returns the gate's verdict alongside the note: a `stale` read is the projector's older state of
// this note, which the caller must not store over fresher data it already holds (BUG-48).
export function getNoteDetail(noteId: string): Promise<GatedResult<NoteDetail>> {
  const stream = noteStream(noteId);
  return gatedReadResult<NoteDetail>(`/notes/${noteId}`, getStreamToken(stream), () => clearStreamToken(stream));
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

// Phase 38-B: replace an existing note's transcript with pasted text and re-analyse, in one
// server-side call. Captures the post-analysis token so the subsequent note read shows the finished,
// analysed note.
export async function importTranscriptIntoNote(noteId: string, transcriptText: string): Promise<void> {
  const response = await requestVoidWithResponse(`/notes/${noteId}/import-transcript`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ transcriptText }),
  });
  captureNoteToken(noteId, response);
}

export async function renameNote(noteId: string, title: string): Promise<void> {
  const response = await requestVoidWithResponse(`/notes/${noteId}/title`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title }),
  });
  captureNoteToken(noteId, response);
}

// BUG-47: PUT /notes/{id}/content returns 409 `stale_content` when `expectedBaseContentHash` no
// longer matches the note's current content — the caller edited a stale/empty view and would
// overwrite real content. Surfaced as a typed error so the note view can keep the typed text and
// offer to load the latest content, never a silent overwrite.
export class StaleContentError extends Error {
  constructor() {
    super('stale_content');
    this.name = 'StaleContentError';
  }
}

// BUG-59: the note was deleted (elsewhere, or in another tab) while this editor was open, so the
// write hit a stream that no longer exists. Terminal like StaleContentError, not the retriable
// failure the generic path assumes — a retry can never succeed.
export class NoteDeletedError extends Error {
  constructor() {
    super('note_not_found');
    this.name = 'NoteDeletedError';
  }
}

export async function editContent(
  noteId: string,
  content: string,
  expectedBaseContentHash?: string,
): Promise<void> {
  // 409 is expected (a stale-base conflict), so it must not throw as a generic failure — handle it.
  // 404 is allowed through for the same reason, but ONLY the discriminated `note_not_found` body is
  // treated as deletion. The sole remaining producer of a BARE 404 on this path is an API Gateway
  // route miss falling through to `/{proxy+}` (34-B shipped one), which never reaches the handler —
  // so a deploy skew cannot trip the deleted-note state. The server's ownership pre-check
  // deliberately shares the `note_not_found` body rather than staying bare (see NoteGone() in
  // NoteHandlers.cs): distinguishing them would hand back an existence oracle. Anything else
  // re-throws as the ApiError the caller already handles.
  const response = await requestVoidWithResponse(
    `/notes/${noteId}/content`,
    {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content, expectedBaseContentHash }),
    },
    [409, 404],
  );
  if (response.status === 409) throw new StaleContentError();
  if (response.status === 404) {
    // A body-less or non-JSON 404 is not evidence of deletion; fall through to the generic error.
    const code = await response
      .json()
      .then((body: unknown) => (body as { error?: string } | null)?.error)
      .catch(() => undefined);
    if (code === 'note_not_found') throw new NoteDeletedError();
    throw new ApiError(404, `PUT /notes/${noteId}/content failed: 404`);
  }
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

export async function deleteNote(noteId: string): Promise<void> {
  // BUG-44: capture the delete's write token (like every other note write) so the cards refetch in
  // useDeleteNote's onSettled waits for the projector to drop the note — else the deleted card
  // reappears from the not-yet-updated projection and stays openable.
  const response = await requestVoidWithResponse(`/notes/${noteId}`, { method: 'DELETE' });
  captureNoteToken(noteId, response);
}

// The cards list plus what the gate actually promised. `stale` means the gate gave up while the
// projector was still behind, so this body predates the write it was waiting on — and `gatedNoteId`
// names the single note that write touched (design decision #7: a list gate holds one stream
// token). That pairing is what lets the caller protect one row instead of the whole list (TI-65).
export interface NoteCardsResult {
  cards: NoteCard[];
  stale: boolean;
  gatedNoteId: string | null;
}

export async function getNoteCards(): Promise<NoteCardsResult> {
  const token = getLatestToken(NOTE_CARDS_SCOPE);
  const { body, stale } = await gatedReadResult<{ cards: NoteCard[] }>(
    `/notes/cards`,
    token,
    () => clearLatestToken(NOTE_CARDS_SCOPE),
  );
  return { cards: body.cards, stale, gatedNoteId: stale ? noteIdFromToken(token) : null };
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
