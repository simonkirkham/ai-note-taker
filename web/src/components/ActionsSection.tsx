import { useEffect, useState } from "react";
import { getActions, addAction, completeAction, reopenAction, ActionItem } from "../api";

export default function ActionsSection({ noteId }: { noteId: string }) {
  const [actions, setActions] = useState<ActionItem[]>([]);
  const [newAction, setNewAction] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [toggling, setToggling] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    getActions(noteId).then((items) => {
      if (!cancelled) setActions(items);
    });
    return () => { cancelled = true; };
  }, [noteId]);

  async function handleToggle(item: ActionItem) {
    if (toggling.has(item.actionId)) return;
    setToggling((prev) => new Set(prev).add(item.actionId));
    try {
      if (item.completed) {
        await reopenAction(noteId, item.actionId);
      } else {
        await completeAction(noteId, item.actionId);
      }
      setActions((prev) =>
        prev.map((a) =>
          a.actionId === item.actionId
            ? { ...a, completed: !a.completed, completedAt: item.completed ? null : new Date().toISOString() }
            : a
        )
      );
    } finally {
      setToggling((prev) => {
        const next = new Set(prev);
        next.delete(item.actionId);
        return next;
      });
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const description = newAction.trim();
    if (!description) return;
    setSubmitting(true);
    try {
      const { actionId } = await addAction(noteId, description);
      setActions((prev) => [
        ...prev,
        { actionId, description, completed: false, addedAt: new Date().toISOString(), completedAt: null },
      ]);
      setNewAction("");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="actions-section" aria-label="Action items">
      <h2 className="actions-heading">Actions</h2>
      {actions.length === 0 ? (
        <p data-testid="actions-empty" className="empty">No action items yet</p>
      ) : (
        <ul data-testid="actions-list" className="actions-list">
          {actions.map((item) => (
            <li key={item.actionId} className={`action-item${item.completed ? " action-item--done" : ""}`}>
              <input
                type="checkbox"
                aria-label={`Mark "${item.description}" ${item.completed ? "open" : "complete"}`}
                checked={item.completed}
                disabled={toggling.has(item.actionId)}
                onChange={() => handleToggle(item)}
                style={{ cursor: "pointer" }}
              />
              <span
                data-testid={`action-description-${item.actionId}`}
                style={{ textDecoration: item.completed ? "line-through" : "none" }}
              >
                {item.description}
              </span>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={handleSubmit} className="action-form">
        <input
          data-testid="action-input"
          type="text"
          value={newAction}
          onChange={(e) => setNewAction(e.target.value)}
          placeholder="Add an action item…"
          className="action-input"
          disabled={submitting}
        />
        <button
          data-testid="add-action-button"
          type="submit"
          className="add-action-button"
          disabled={submitting || !newAction.trim()}
        >
          Add
        </button>
      </form>
    </section>
  );
}
