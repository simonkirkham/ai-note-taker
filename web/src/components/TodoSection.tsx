import { useEffect, useState } from "react";
import { getTodos, completeAction, TodoItem } from "../api";

export default function TodoSection() {
  const [items, setItems] = useState<TodoItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    getTodos()
      .then((data) => { if (!cancelled) { setItems(data); setLoading(false); } })
      .catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  async function handleComplete(item: TodoItem) {
    if (toggling.has(item.actionId)) return;
    setToggling((prev) => new Set(prev).add(item.actionId));
    try {
      await completeAction(item.noteId, item.actionId);
      setItems((prev) => prev.filter((i) => i.actionId !== item.actionId));
    } finally {
      setToggling((prev) => {
        const next = new Set(prev);
        next.delete(item.actionId);
        return next;
      });
    }
  }

  return (
    <section data-testid="todo-section" className="todo-section" aria-label="To-do items" aria-live="polite">
      <h2 className="todo-heading">To Do</h2>
      {loading ? (
        <p className="loading">Loading…</p>
      ) : items.length === 0 ? (
        <p data-testid="todo-empty" className="empty">Your to-do list is clear.</p>
      ) : (
        <ul data-testid="todo-list" className="todo-list">
          {items.map((item) => (
            <li key={item.actionId} className="todo-item">
              <input
                type="checkbox"
                className="todo-checkbox"
                aria-label={`Complete "${item.description}"`}
                checked={toggling.has(item.actionId)}
                disabled={toggling.has(item.actionId)}
                onChange={() => handleComplete(item)}
              />
              <span className="todo-description">{item.description}</span>
              <span className="todo-note-title">{item.noteTitle}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
