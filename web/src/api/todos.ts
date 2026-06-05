import { request, requestVoid } from './client'

export interface TodoItem {
  itemId: string;
  type: "action" | "todo";
  noteId: string | null;
  noteTitle: string | null;
  description: string;
  addedAt: string;
  completedAt: string | null;
}

export async function getTodos(): Promise<TodoItem[]> {
  const body = await request<{ items: TodoItem[] }>(`/todos`);
  return body.items;
}

export function addTodo(description: string, priority?: string): Promise<{ todoId: string }> {
  return request<{ todoId: string }>(`/todos`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ description, priority: priority ?? null }),
  });
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
