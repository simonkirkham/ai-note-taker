import { safeSession } from "../lib/safeStorage";

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

// sessionStorage may be unavailable (private-mode quota, a blocked context) and THROWS rather than
// returning null. RYW then degrades to no token — a read may come back stale — instead of taking
// the app down. This module's guards are now the shared ones (lib/safeStorage, BUG-60).
const safeSet = safeSession.set;
const safeGet = safeSession.get;
const safeRemove = safeSession.remove;

// A write token is `<stream>@<version>`; stream versions are monotonic. Parse the two parts so a
// later capture can't regress the gate to an older version (BUG-22).
export function tokenStream(token: string): string {
  const at = token.lastIndexOf("@");
  return at >= 0 ? token.slice(0, at) : token;
}
function tokenVersion(token: string): number {
  const at = token.lastIndexOf("@");
  const v = at >= 0 ? Number(token.slice(at + 1)) : Number.NaN;
  return Number.isFinite(v) ? v : -1;
}

// --- Per-stream tokens (single-entity reads) ---
// Keep the HIGHER version. Concurrent same-stream writes (a space-separated multi-tag add fans out
// into two POSTs returning note#id@N and note#id@N+1) race to this single slot; without the guard
// whichever HTTP response lands LAST wins, so ~half the time the slot holds the older @N. The next
// gated read then releases once the projector has folded only the first write and drops the second
// tag's pill (BUG-22). The slot key already pins the stream, so a version compare is sufficient.
export function setStreamToken(streamId: string, token: string): void {
  const existing = safeGet(STREAM_PREFIX + streamId);
  if (existing && tokenVersion(existing) >= tokenVersion(token)) return;
  safeSet(STREAM_PREFIX + streamId, token);
}
export function getStreamToken(streamId: string): string | null {
  return safeGet(STREAM_PREFIX + streamId);
}
export function clearStreamToken(streamId: string): void {
  safeRemove(STREAM_PREFIX + streamId);
}

// --- Per-list "latest write" pointers (list reads) ---
// Keep max-version ONLY when the stored token is the SAME stream (the BUG-22 concurrent same-stream
// race, e.g. a multi-tag add updating one note's card row). A write to a DIFFERENT stream legitimately
// moves the "latest write" pointer regardless of version (design #7: a list read waits on the stream
// just written), so cross-stream always replaces.
export function setLatestToken(scope: string, token: string): void {
  const existing = safeGet(LATEST_PREFIX + scope);
  if (existing && tokenStream(existing) === tokenStream(token) && tokenVersion(existing) >= tokenVersion(token)) return;
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
