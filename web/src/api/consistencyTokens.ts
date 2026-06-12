// Session store for the latest todo write token (RYW-1).
//
// Read-your-writes is a SERVER guarantee: POST /todos returns a per-stream
// consistency token (`todo#<id>@<version>`); the next GET /todos echoes it in the
// `If-Consistent-With` header so the server waits until the async projector has
// applied that write before answering. This module is the tiny client side of that
// loop — capture the latest todo token, attach it on the next read, clear it once a
// non-stale read confirms the projection caught up.
//
// Persisted in `sessionStorage` (not a module global) so the token SURVIVES A PAGE
// RELOAD: after adding a todo, a reload drops the optimistic cache, and the gated
// server read (carrying the persisted token) is what makes the todo reappear — the
// real read-your-writes proof, independent of any optimistic UI.
//
// Scoped to todos for RYW-1. RYW-2 generalises this to a per-stream map.
const KEY = "ryw.pendingTodoToken";

export function setPendingTodoToken(token: string): void {
  try {
    sessionStorage.setItem(KEY, token);
  } catch {
    // sessionStorage unavailable (e.g. private-mode quota) — RYW degrades to no token (read may be stale).
  }
}

export function getPendingTodoToken(): string | null {
  try {
    return sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function clearPendingTodoToken(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
