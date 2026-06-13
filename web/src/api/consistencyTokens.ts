// Session store for read-your-writes consistency tokens (RYW-1 todos, RYW-2 notes).
//
// Read-your-writes is a SERVER guarantee: a write returns a per-stream consistency token
// (`<stream>@<version>`); the next read echoes it in the `If-Consistent-With` header so the
// server waits until the async projector has applied that write before answering. This module is
// the tiny client side of that loop — capture the latest write token, attach it on the next read,
// clear it once a non-stale read confirms the projection caught up.
//
// Two shapes:
//  - per-stream tokens — a read of ONE entity (`GET /notes/{id}`) waits on exactly that stream.
//  - per-list "latest write" pointers — a LIST read (`GET /todos`, `GET /notes/cards`) waits on
//    the single stream the user most recently wrote (design decision #7: a list read holds a token
//    only for the stream just written, so it waits on that one contribution).
//
// Persisted in `sessionStorage` (not a module global) so a token SURVIVES A PAGE RELOAD: after a
// write, a reload drops the optimistic cache, and the gated server read (carrying the persisted
// token) is what makes the change reappear — the real read-your-writes proof, independent of any
// optimistic UI.
const STREAM_PREFIX = "ryw.stream.";
const LATEST_PREFIX = "ryw.latest.";

function safeSet(key: string, value: string): void {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    // sessionStorage unavailable (e.g. private-mode quota) — RYW degrades to no token (read may be stale).
  }
}

function safeGet(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeRemove(key: string): void {
  try {
    sessionStorage.removeItem(key);
  } catch {
    // ignore
  }
}

// --- Per-stream tokens (single-entity reads) ---
export function setStreamToken(streamId: string, token: string): void {
  safeSet(STREAM_PREFIX + streamId, token);
}
export function getStreamToken(streamId: string): string | null {
  return safeGet(STREAM_PREFIX + streamId);
}
export function clearStreamToken(streamId: string): void {
  safeRemove(STREAM_PREFIX + streamId);
}

// --- Per-list "latest write" pointers (list reads) ---
export function setLatestToken(scope: string, token: string): void {
  safeSet(LATEST_PREFIX + scope, token);
}
export function getLatestToken(scope: string): string | null {
  return safeGet(LATEST_PREFIX + scope);
}
export function clearLatestToken(scope: string): void {
  safeRemove(LATEST_PREFIX + scope);
}

// --- RYW-1 todo helpers (kept as thin wrappers over the "todos" list slot) ---
export function setPendingTodoToken(token: string): void {
  setLatestToken("todos", token);
}
export function getPendingTodoToken(): string | null {
  return getLatestToken("todos");
}
export function clearPendingTodoToken(): void {
  clearLatestToken("todos");
}
