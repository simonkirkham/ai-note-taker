// Session high-water store for the latest todo write token (RYW-1).
//
// Read-your-writes is a SERVER guarantee: POST /todos returns a per-stream
// consistency token (`todo#<id>@<version>`); the next GET /todos echoes it in the
// `If-Consistent-With` header so the server waits until the async projector has
// applied that write before answering. This module is the tiny client side of that
// loop — capture the latest todo token, attach it on the next read, clear it once a
// non-stale read confirms the projection caught up.
//
// Scoped to todos for RYW-1. RYW-2 generalises this to a per-stream map.
let pendingTodoToken: string | null = null;

export function setPendingTodoToken(token: string): void {
  pendingTodoToken = token;
}

export function getPendingTodoToken(): string | null {
  return pendingTodoToken;
}

export function clearPendingTodoToken(): void {
  pendingTodoToken = null;
}
