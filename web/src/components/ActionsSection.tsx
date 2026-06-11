import clsx from "clsx";
import { useEffect, useState } from "react";
import { ActionItem } from "../api/actions";
import {
  useAddAction,
  useCompleteAction,
  useReopenAction,
  useDeleteAction,
} from "../hooks/useActionMutations";
import { useActions } from "../hooks/useActions";
import styles from "./ActionsSection.module.css";

export default function ActionsSection({
  noteId,
  onCountChange,
}: {
  noteId: string;
  onCountChange?: (count: number) => void;
}) {
  const { data: actions = [] } = useActions(noteId);
  const addAction = useAddAction(noteId);
  const completeAction = useCompleteAction(noteId);
  const reopenAction = useReopenAction(noteId);
  const deleteActionM = useDeleteAction(noteId);
  const [newAction, setNewAction] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [toggling, setToggling] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState<Set<string>>(new Set());

  useEffect(() => {
    onCountChange?.(actions.length);
  }, [actions.length, onCountChange]);

  async function handleToggle(item: ActionItem) {
    if (toggling.has(item.actionId)) return;
    setToggling((prev) => new Set(prev).add(item.actionId));
    try {
      if (item.completed) await reopenAction.mutateAsync(item.actionId);
      else await completeAction.mutateAsync(item.actionId);
    } catch {
      // optimistic update already rolled back in the mutation's onError
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
      await deleteActionM.mutateAsync(item.actionId);
    } catch {
      // rolled back in onError
    } finally {
      setDeleting((prev) => {
        const next = new Set(prev);
        next.delete(item.actionId);
        return next;
      });
    }
  }

  async function handleSubmitDescription(description: string) {
    if (!description || submitting) return;
    setSubmitting(true);
    try {
      await addAction.mutateAsync({ description, tempId: `temp-${crypto.randomUUID()}` });
      setNewAction("");
    } catch {
      // rolled back in onError
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className={styles.actionsSection} data-testid="actions-section" aria-label="Action items">
      <h2 className={styles.actionsHeading}>Actions</h2>
      {actions.length === 0 ? (
        <p data-testid="actions-empty" className="empty" role="status">No action items yet</p>
      ) : (
        <ul data-testid="actions-list" className={styles.actionsList}>
          {actions.map((item) => (
            <li
              key={item.actionId}
              className={clsx(styles.actionItem, { [styles.actionItemDone]: item.completed })}
            >
              <input
                type="checkbox"
                className={styles.actionCheckbox}
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
                className={styles.deleteActionButton}
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
      <input
        data-testid="action-input"
        type="text"
        value={newAction}
        onChange={(e) => setNewAction(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            handleSubmitDescription(newAction.trim());
          }
        }}
        onBlur={() => handleSubmitDescription(newAction.trim())}
        placeholder="Add an action item…"
        className={styles.actionInput}
        disabled={submitting}
      />
    </section>
  );
}
