import { request, requestVoid, requestWithResponse } from './client'
import { clearPendingTodoToken, getPendingTodoToken, setPendingTodoToken } from './consistencyTokens'

interface TodoItemBase {
  itemId: string;
  noteTitle: string | null;
  description: string;
  addedAt: string;
  completedAt: string | null;
}

// Discriminated on `type`: an "action" is anchored to a note (noteId: string),
// a free-standing "todo" is not (noteId: null). Narrowing on `item.type` lets
// the action mutations reach item.noteId without a non-null assertion.
export type TodoItem =
  | (TodoItemBase & { type: "action"; noteId: string })
  | (TodoItemBase & { type: "todo"; noteId: null });

// Read-your-writes (RYW-1): if a pending todo write token is present, attach it as
// `If-Consistent-With` so the server waits until the projector applied that write.
// If the server gives up (X-Consistency: stale), retry a couple of times — each retry
// re-sends the token so the server waits again as the projector catches up. After a
// non-stale read, clear the token (the projection is confirmed caught up).
const STALE_RETRIES = 2;
const STALE_RETRY_DELAY_MS = 300;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function getTodos(): Promise<TodoItem[]> {
  const token = getPendingTodoToken();
  const headers: Record<string, string> = token ? { "If-Consistent-With": token } : {};

  for (let attempt = 0; ; attempt++) {
    const { body, response } = await requestWithResponse<{ items: TodoItem[] }>(`/todos`, { headers });
    const stale = response.headers.get("X-Consistency") === "stale";
    if (!stale) {
      // Read confirmed the projection caught up (or there was no token to wait on).
      clearPendingTodoToken();
      return body.items;
    }
    if (attempt >= STALE_RETRIES) {
      // Still stale after retries — return what we have; the optimistic temp row stays.
      return body.items;
    }
    await sleep(STALE_RETRY_DELAY_MS);
  }
}

export async function addTodo(
  description: string,
  priority?: string,
): Promise<{ todoId: string; consistencyToken: string }> {
  const result = await request<{ todoId: string; consistencyToken: string }>(`/todos`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ description, priority: priority ?? null }),
  });
  // Capture the write token so the next GET /todos refetch reads-your-writes.
  setPendingTodoToken(result.consistencyToken);
  return result;
}

// Persist a new order for the home To Do open-items list (full-order snapshot of item ids).
// Captures the write token so the next GET /todos reads-your-writes past the async projector.
export async function reorderTodos(orderedItemIds: string[]): Promise<void> {
  const result = await request<{ consistencyToken: string }>(`/todos/reorder`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ orderedItemIds }),
  });
  setPendingTodoToken(result.consistencyToken);
}

export function completeTodo(todoId: string): Promise<void> {
  return requestVoid(`/todos/${todoId}/complete`, { method: "POST" });
}

export function reopenTodo(todoId: string): Promise<void> {
  return requestVoid(`/todos/${todoId}/reopen`, { method: "POST" });
}

export function deleteTodo(todoId: string): Promise<void> {
  return requestVoid(`/todos/${todoId}`, { method: "DELETE" });
}

export function editTodo(todoId: string, description: string): Promise<void> {
  return requestVoid(`/todos/${todoId}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ description }),
  });
}
