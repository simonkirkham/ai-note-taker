import { useEffect, useState } from "react";
import { getTodos, TodoItem } from "../api";

export default function TodoSection() {
  const [items, setItems] = useState<TodoItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    getTodos()
      .then((data) => { if (!cancelled) { setItems(data); setLoading(false); } })
      .catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

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
              <span className="todo-description">{item.description}</span>
              <span className="todo-note-title">{item.noteTitle}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
