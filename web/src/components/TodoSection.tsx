import { useEffect, useState } from "react";
import {
  getTodos, TodoItem,
  completeAction, reopenAction, deleteAction,
  completeTodo, reopenTodo, deleteTodo,
} from "../api";
import QuickCaptureTodoInput from "./QuickCaptureTodoInput";
import { TrashIcon } from "./icons";

function isToday(isoString: string): boolean {
  const d = new Date(isoString);
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

export default function TodoSection() {
  const [items, setItems] = useState<TodoItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [doneOpen, setDoneOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getTodos()
      .then((data) => { if (!cancelled) { setItems(data); setLoading(false); } })
      .catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const openItems = items.filter((i) => i.completedAt === null);
  const doneItems = items.filter((i) => i.completedAt !== null && isToday(i.completedAt));

  function addBusy(id: string) {
    setBusy((prev) => new Set(prev).add(id));
  }
  function removeBusy(id: string) {
    setBusy((prev) => { const next = new Set(prev); next.delete(id); return next; });
  }

  function handleOptimisticAdd(item: TodoItem) {
    setItems((prev) => {
      const existing = prev.findIndex((i) => i.itemId === item.itemId);
      if (existing >= 0) {
        const next = [...prev];
        next[existing] = item;
        return next;
      }
      return [item, ...prev];
    });
  }

  function handleAddConfirmed(tempId: string, realId: string) {
    setItems((prev) => prev.map((i) => i.itemId === tempId ? { ...i, itemId: realId } : i));
  }

  function handleAddFailed(tempId: string) {
    setItems((prev) => prev.filter((i) => i.itemId !== tempId));
  }

  async function handleComplete(item: TodoItem) {
    if (busy.has(item.itemId)) return;
    addBusy(item.itemId);
    const completedAt = new Date().toISOString();
    setItems((prev) => prev.map((i) => i.itemId === item.itemId ? { ...i, completedAt } : i));
    try {
      if (item.type === "action") await completeAction(item.noteId!, item.itemId);
      else await completeTodo(item.itemId);
    } catch {
      setItems((prev) => prev.map((i) => i.itemId === item.itemId ? { ...i, completedAt: null } : i));
    } finally {
      removeBusy(item.itemId);
    }
  }

  async function handleReopen(item: TodoItem) {
    if (busy.has(item.itemId)) return;
    addBusy(item.itemId);
    const originalCompletedAt = item.completedAt;
    setItems((prev) => prev.map((i) => i.itemId === item.itemId ? { ...i, completedAt: null } : i));
    try {
      if (item.type === "action") await reopenAction(item.noteId!, item.itemId);
      else await reopenTodo(item.itemId);
    } catch {
      setItems((prev) => prev.map((i) => i.itemId === item.itemId ? { ...i, completedAt: originalCompletedAt } : i));
    } finally {
      removeBusy(item.itemId);
    }
  }

  async function handleDelete(item: TodoItem) {
    if (busy.has(item.itemId)) return;
    addBusy(item.itemId);
    setItems((prev) => prev.filter((i) => i.itemId !== item.itemId));
    try {
      if (item.type === "action") await deleteAction(item.noteId!, item.itemId);
      else await deleteTodo(item.itemId);
    } catch {
      setItems((prev) => [item, ...prev]);
    } finally {
      removeBusy(item.itemId);
    }
  }

  return (
    <section data-testid="todo-section" className="todo-section" aria-label="To-do items" aria-live="polite">
      <h2 className="todo-heading">To Do</h2>
      <QuickCaptureTodoInput
        onAdded={handleOptimisticAdd}
        onConfirmed={handleAddConfirmed}
        onFailed={handleAddFailed}
      />
      {loading ? (
        <p className="loading">Loading…</p>
      ) : openItems.length === 0 && doneItems.length === 0 ? (
        <p data-testid="todo-empty" className="empty">Your to-do list is clear.</p>
      ) : (
        <>
          {openItems.length > 0 && (
            <ul data-testid="todo-list" className="todo-list">
              {openItems.map((item) => (
                <li key={item.itemId} className="todo-item">
                  <input
                    type="checkbox"
                    className="todo-checkbox"
                    aria-label={`Complete "${item.description}"`}
                    checked={false}
                    disabled={busy.has(item.itemId)}
                    onChange={() => handleComplete(item)}
                  />
                  <div className="todo-item-content">
                    <span className="todo-description">{item.description}</span>
                    {item.noteTitle && <span className="todo-note-title">{item.noteTitle}</span>}
                  </div>
                  <button
                    className="icon-btn icon-btn--danger"
                    aria-label={`Delete "${item.description}"`}
                    disabled={busy.has(item.itemId)}
                    onClick={() => handleDelete(item)}
                  >
                    <TrashIcon />
                  </button>
                </li>
              ))}
            </ul>
          )}
          {doneItems.length > 0 && (
            <div className="todo-done-section">
              <button
                className="todo-done-toggle"
                onClick={() => setDoneOpen((o) => !o)}
                aria-expanded={doneOpen}
                aria-controls="todo-done-list"
              >
                Done ({doneItems.length})
              </button>
              {doneOpen && (
                <ul id="todo-done-list" className="todo-done-list">
                  {doneItems.map((item) => (
                    <li key={item.itemId} className="todo-item todo-item--done">
                      <div className="todo-item-content">
                        <span className="todo-description">{item.description}</span>
                        {item.noteTitle && <span className="todo-note-title">{item.noteTitle}</span>}
                      </div>
                      <button
                        className="todo-reopen-btn"
                        aria-label={`Reopen "${item.description}"`}
                        disabled={busy.has(item.itemId)}
                        onClick={() => handleReopen(item)}
                      >
                        Reopen
                      </button>
                      <button
                        className="icon-btn icon-btn--danger"
                        aria-label={`Delete "${item.description}"`}
                        disabled={busy.has(item.itemId)}
                        onClick={() => handleDelete(item)}
                      >
                        <TrashIcon />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
