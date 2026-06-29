import { request, requestVoidWithResponse } from './client';
import { captureNoteToken } from './notes';

export interface RecordingPresignUploadResult {
  key: string;
  uploadUrl: string;
  contentType: string;
}

export function presignRecordingUpload(
  noteId: string,
  body: { contentType: string; contentLength: number },
): Promise<RecordingPresignUploadResult> {
  return request<RecordingPresignUploadResult>(`/notes/${noteId}/recording/presign-upload`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function saveRecording(noteId: string, key: string): Promise<void> {
  const response = await requestVoidWithResponse(`/notes/${noteId}/recording`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ key }),
  });
  captureNoteToken(noteId, response);
}

export async function presignRecordingDownload(noteId: string): Promise<string> {
  const body = await request<{ downloadUrl: string }>(`/notes/${noteId}/recording/presign-download`, {
    method: 'POST',
  });
  return body.downloadUrl;
}
