import clsx from "clsx";
import { useRef, useState } from "react";
import { ActionItem } from "../api/actions";
import {
  useAddAction,
  useCompleteAction,
  useReopenAction,
  useEditAction,
  useDeleteAction,
} from "../hooks/useActionMutations";
import { useActions } from "../hooks/useActions";
import styles from "./ActionsSection.module.css";

export default function ActionsSection({
  noteId,
  showHeading = true,
}: {
  noteId: string;
  showHeading?: boolean;
}) {
  const { data: actions = [] } = useActions(noteId);
  const addAction = useAddAction(noteId);
  const completeAction = useCompleteAction(noteId);
  const reopenAction = useReopenAction(noteId);
  const editActionM = useEditAction(noteId);
  const deleteActionM = useDeleteAction(noteId);
  const [newAction, setNewAction] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [toggling, setToggling] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  // Tracks the row being edited synchronously, so a native blur fired as the input
  // unmounts on Enter can't re-enter commitEdit and send a duplicate PUT.
  const editingRef = useRef<string | null>(null);

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

  function startEdit(item: ActionItem) {
    editingRef.current = item.actionId;
    setEditingId(item.actionId);
    setEditText(item.description);
  }

  function cancelEdit() {
    editingRef.current = null;
    setEditingId(null);
    setEditText("");
  }

  async function commitEdit(item: ActionItem) {
    if (editingRef.current !== item.actionId) return;
    editingRef.current = null;
    const description = editText.trim();
    setEditingId(null);
    if (!description || description === item.description) return;
    try {
      await editActionM.mutateAsync({ actionId: item.actionId, description });
    } catch {
      // optimistic update already rolled back in the mutation's onError
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
      {showHeading && <h2 className={styles.actionsHeading}>Actions</h2>}
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
                onChange={() => void handleToggle(item)}
              />
              {editingId === item.actionId ? (
                // autoFocus is intentional: the edit input appears in direct
                // response to the user choosing to edit, so focusing it is expected.
                // eslint-disable-next-line jsx-a11y/no-autofocus
                <input autoFocus
                  data-testid={`edit-action-input-${item.actionId}`}
                  className={styles.editActionInput}
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  onBlur={() => void commitEdit(item)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") { e.preventDefault(); void commitEdit(item); }
                    if (e.key === "Escape") { e.preventDefault(); cancelEdit(); }
                  }}
                  aria-label={`Edit "${item.description}"`}
                />
              ) : (
                <button
                  type="button"
                  data-testid={`action-description-${item.actionId}`}
                  className={styles.actionDescription}
                  aria-label={`Edit "${item.description}"`}
                  disabled={toggling.has(item.actionId) || deleting.has(item.actionId)}
                  onClick={() => startEdit(item)}
                >
                  {item.description}
                </button>
              )}
              <button
                data-testid={`delete-action-${item.actionId}`}
                className={styles.deleteActionButton}
                aria-label={`Delete "${item.description}"`}
                disabled={deleting.has(item.actionId) || toggling.has(item.actionId)}
                onClick={() => void handleDelete(item)}
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
            void handleSubmitDescription(newAction.trim());
          }
        }}
        onBlur={() => void handleSubmitDescription(newAction.trim())}
        placeholder="Add an action item…"
        className={styles.actionInput}
        disabled={submitting}
      />
    </section>
  );
}
