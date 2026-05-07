import { useEffect, useState } from "react";
import { getActions, addAction, completeAction, reopenAction, deleteAction, ActionItem } from "../api";

export default function ActionsSection({ noteId }: { noteId: string }) {
  const [actions, setActions] = useState<ActionItem[]>([]);
  const [newAction, setNewAction] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [toggling, setToggling] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState<Set<string>>(new Set());

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

  async function handleDelete(item: ActionItem) {
    if (deleting.has(item.actionId)) return;
    setDeleting((prev) => new Set(prev).add(item.actionId));
    try {
      await deleteAction(noteId, item.actionId);
      setActions((prev) => prev.filter((a) => a.actionId !== item.actionId));
    } finally {
      setDeleting((prev) => {
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
    <section className="actions-section" data-testid="actions-section" aria-label="Action items">
      <h2 className="actions-heading">Actions</h2>
      {actions.length === 0 ? (
        <p data-testid="actions-empty" className="empty">No action items yet</p>
      ) : (
        <ul data-testid="actions-list" className="actions-list">
          {actions.map((item) => (
            <li key={item.actionId} className={`action-item${item.completed ? " action-item--done" : ""}`}>
              <input
                type="checkbox"
                className="action-checkbox"
                aria-label={`Mark "${item.description}" ${item.completed ? "open" : "complete"}`}
                checked={item.completed}
                disabled={toggling.has(item.actionId) || deleting.has(item.actionId)}
                onChange={() => handleToggle(item)}
              />
              <span data-testid={`action-description-${item.actionId}`}>
                {item.description}
              </span>
              <button
                data-testid={`delete-action-${item.actionId}`}
                className="delete-action-button"
                aria-label={`Delete "${item.description}"`}
                disabled={deleting.has(item.actionId) || toggling.has(item.actionId)}
                onClick={() => handleDelete(item)}
              >
                ×
              </button>
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
