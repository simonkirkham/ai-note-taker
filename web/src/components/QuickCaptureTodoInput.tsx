import { useRef, useState } from "react";
import { addTodo, TodoItem } from "../api/todos";

import styles from "./QuickCaptureTodoInput.module.css";

interface Props {
  onAdded: (item: TodoItem) => void;
  onConfirmed: (tempId: string, realId: string) => void;
  onFailed: (tempId: string) => void;
}

export default function QuickCaptureTodoInput({ onAdded, onConfirmed, onFailed }: Props) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function submit() {
    const trimmed = value.trim();
    if (!trimmed) return;
    setError(null);
    setSubmitting(true);
    const tempId = `temp-${Date.now()}`;
    const optimistic: TodoItem = {
      itemId: tempId,
      type: "todo",
      noteId: null,
      noteTitle: null,
      description: trimmed,
      addedAt: new Date().toISOString(),
      completedAt: null,
    };
    onAdded(optimistic);
    setValue("");
    inputRef.current?.focus();
    try {
      const { todoId } = await addTodo(trimmed);
      onConfirmed(tempId, todoId.toString());
    } catch {
      onFailed(tempId);
      setError("Failed to add to-do. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") submit();
  }

  return (
    <div className={styles.quickCaptureInput}>
      <input
        ref={inputRef}
        type="text"
        placeholder="Add a to-do…"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={submitting}
        aria-label="New to-do description"
      />
      <button onClick={submit} disabled={submitting} aria-label="Add to-do">
        Add
      </button>
      {error && <p className={styles.quickCaptureError}>{error}</p>}
    </div>
  );
}
