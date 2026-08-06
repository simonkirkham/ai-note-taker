import { useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { useRef, useState } from "react";
import { keys } from "../api/queryKeys";
import { TodoItem, TodoListData } from "../api/todos";
import { useCompleteTodo, useReopenTodo, useEditTodo, useDeleteTodo, useReorderTodos, useSetTodayLine } from "../hooks/useTodoMutations";
import { useTodos } from "../hooks/useTodos";
import { TrashIcon, GripVerticalIcon } from "./icons";
import QuickCaptureTodoInput from "./QuickCaptureTodoInput";
import styles from "./TodoSection.module.css";

// The Today line is dragged like a row, so it needs its own id in the same drag slot.
const TODAY_LINE_DRAG_ID = "__today-line__";

function isToday(isoString: string): boolean {
  const d = new Date(isoString);
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

function arrayMove<T>(arr: T[], from: number, to: number): T[] {
  const next = [...arr];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

export default function TodoSection() {
  const qc = useQueryClient();
  const { data, isLoading: loading } = useTodos();
  const items = data?.items ?? [];
  const complete = useCompleteTodo();
  const reopen = useReopenTodo();
  const edit = useEditTodo();
  const remove = useDeleteTodo();
  const reorder = useReorderTodos();
  const setLine = useSetTodayLine();
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [doneOpen, setDoneOpen] = useState(false);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  // Tracks the row being edited synchronously, so a native blur fired as the input
  // unmounts on Enter can't re-enter commitEdit and send a duplicate PUT.
  const editingRef = useRef<string | null>(null);

  const openItems = items.filter((i) => i.completedAt === null);
  const doneItems = items.filter((i) => i.completedAt !== null && isToday(i.completedAt));

  // The line sits immediately ABOVE its anchor. A null anchor — or one that has since gone —
  // puts it below everything, so the whole open list is Today.
  const anchorItemId = data?.todayLineAnchorItemId ?? null;
  const anchorIndex = anchorItemId ? openItems.findIndex((i) => i.itemId === anchorItemId) : -1;
  const splitAt = anchorIndex >= 0 ? anchorIndex : openItems.length;
  const todayItems = openItems.slice(0, splitAt);
  const laterItems = openItems.slice(splitAt);
  const draggingLine = draggedId === TODAY_LINE_DRAG_ID;

  // Reorder the open items, optimistically and persisted. Pass the full new id order.
  function reorderTo(orderedIds: string[]) {
    if (orderedIds.length > 1) reorder.mutate(orderedIds);
  }

  function handleDrop(targetId: string) {
    const ids = openItems.map((i) => i.itemId);
    const dragged = draggedId;
    setDraggedId(null);
    // Dropping the line on a row puts the line immediately above that row.
    if (dragged === TODAY_LINE_DRAG_ID) {
      if (targetId !== anchorItemId) setLine.mutate(targetId);
      return;
    }
    const from = dragged ? ids.indexOf(dragged) : -1;
    const to = ids.indexOf(targetId);
    if (from < 0 || to < 0 || from === to) return;
    reorderTo(arrayMove(ids, from, to));
  }

  // Dropping a row onto the line itself (or onto an empty Today group) makes it the last
  // Today item — directly above the line, which does not move.
  function handleDropOnLine() {
    const ids = openItems.map((i) => i.itemId);
    const dragged = draggedId;
    setDraggedId(null);
    if (dragged === null || dragged === TODAY_LINE_DRAG_ID) return;
    const from = ids.indexOf(dragged);
    if (from < 0) return;
    const to = from < splitAt ? splitAt - 1 : splitAt;
    if (from === to) return;
    reorderTo(arrayMove(ids, from, to));
  }

  // The zone past the last row: the only way to send the line back below everything.
  function handleDropAtEnd() {
    const dragged = draggedId;
    setDraggedId(null);
    if (dragged === TODAY_LINE_DRAG_ID && anchorItemId !== null) setLine.mutate(null);
  }

  function addBusy(id: string) {
    setBusy((prev) => new Set(prev).add(id));
  }
  function removeBusy(id: string) {
    setBusy((prev) => { const next = new Set(prev); next.delete(id); return next; });
  }

  // The add flow is owned by QuickCaptureTodoInput; these callbacks reconcile the query cache.
  function patchItems(apply: (items: TodoItem[]) => TodoItem[]) {
    qc.setQueryData<TodoListData>(keys.todos, (prev) => ({
      items: apply(prev?.items ?? []),
      todayLineAnchorItemId: prev?.todayLineAnchorItemId ?? null,
    }));
  }

  function handleOptimisticAdd(item: TodoItem) {
    patchItems((prev) => {
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
    patchItems((prev) => prev.map((i) => i.itemId === tempId ? { ...i, itemId: realId } : i));
  }

  function handleAddFailed(tempId: string) {
    patchItems((prev) => prev.filter((i) => i.itemId !== tempId));
  }

  async function handleComplete(item: TodoItem) {
    if (busy.has(item.itemId)) return;
    addBusy(item.itemId);
    try {
      await complete.mutateAsync(item);
    } catch {
      // optimistic update already rolled back in the mutation's onError
    } finally {
      removeBusy(item.itemId);
    }
  }

  async function handleReopen(item: TodoItem) {
    if (busy.has(item.itemId)) return;
    addBusy(item.itemId);
    try {
      await reopen.mutateAsync(item);
    } catch {
      // rolled back in onError
    } finally {
      removeBusy(item.itemId);
    }
  }

  function startEdit(item: TodoItem) {
    editingRef.current = item.itemId;
    setEditingId(item.itemId);
    setEditText(item.description);
  }

  function cancelEdit() {
    editingRef.current = null;
    setEditingId(null);
    setEditText("");
  }

  async function commitEdit(item: TodoItem) {
    if (editingRef.current !== item.itemId) return;
    editingRef.current = null;
    const description = editText.trim();
    setEditingId(null);
    if (!description || description === item.description) return;
    try {
      await edit.mutateAsync({ item, description });
    } catch {
      // optimistic update already rolled back in the mutation's onError
    }
  }

  async function handleDelete(item: TodoItem) {
    if (busy.has(item.itemId)) return;
    addBusy(item.itemId);
    try {
      // Deleting the anchor removes the row the line hangs off, and a deleted row leaves no
      // place for the server to resolve from — so re-anchor to the next open item first.
      if (item.itemId === anchorItemId) {
        const from = openItems.findIndex((i) => i.itemId === item.itemId);
        await setLine.mutateAsync(openItems[from + 1]?.itemId ?? null);
      }
      await remove.mutateAsync(item);
    } catch {
      // rolled back in onError
    } finally {
      removeBusy(item.itemId);
    }
  }

  function renderOpenItem(item: TodoItem) {
    return (
      <li
        key={item.itemId}
        className={clsx(styles.todoItem, draggedId === item.itemId && styles.todoItemDragging)}
        draggable
        onDragStart={() => setDraggedId(item.itemId)}
        onDragEnd={() => setDraggedId(null)}
        onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; }}
        onDrop={(e) => { e.preventDefault(); handleDrop(item.itemId); }}
      >
        <span className={styles.todoDragHandle} aria-hidden="true" title="Drag to reorder">
          <GripVerticalIcon />
        </span>
        <input
          type="checkbox"
          className={styles.todoCheckbox}
          aria-label={`Complete "${item.description}"`}
          checked={false}
          disabled={busy.has(item.itemId)}
          onChange={() => void handleComplete(item)}
        />
        <div className={styles.todoItemContent}>
          {editingId === item.itemId ? (
            // autoFocus is intentional: the edit input appears in direct response to the
            // user choosing to edit, so focusing it is expected.
            // eslint-disable-next-line jsx-a11y/no-autofocus
            <input autoFocus
              data-testid={`edit-todo-input-${item.itemId}`}
              className={styles.editTodoInput}
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
              data-testid={`todo-description-${item.itemId}`}
              className={styles.todoDescriptionButton}
              aria-label={`Edit "${item.description}"`}
              disabled={busy.has(item.itemId)}
              onClick={() => startEdit(item)}
            >
              {item.description}
            </button>
          )}
          {item.noteTitle && <span className={styles.todoNoteTitle}>{item.noteTitle}</span>}
        </div>
        <button
          className="icon-btn icon-btn--danger"
          aria-label={`Delete "${item.description}"`}
          disabled={busy.has(item.itemId)}
          onClick={() => void handleDelete(item)}
        >
          <TrashIcon />
        </button>
      </li>
    );
  }

  return (
    <section data-testid="todo-section" className={styles.todoSection} aria-label="To-do items" aria-live="polite">
      <h2 className={styles.todoHeading}>To Do</h2>
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
            <>
              <h3 id="todo-today-heading" className={styles.todoGroupHeading}>Today</h3>
              {todayItems.length > 0 ? (
                <ul data-testid="todo-list" className={styles.todoList} aria-labelledby="todo-today-heading">
                  {todayItems.map(renderOpenItem)}
                </ul>
              ) : (
                <p
                  data-testid="todo-today-empty"
                  className={styles.todoGroupEmpty}
                  onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; }}
                  onDrop={(e) => { e.preventDefault(); handleDropOnLine(); }}
                >
                  Nothing in today yet.
                </p>
              )}
              <div
                data-testid="today-line"
                role="separator"
                aria-label="Today line — drag to move"
                title="Drag to move where today ends"
                className={clsx(styles.todayLine, draggingLine && styles.todayLineDragging)}
                draggable
                onDragStart={() => setDraggedId(TODAY_LINE_DRAG_ID)}
                onDragEnd={() => setDraggedId(null)}
                onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; }}
                onDrop={(e) => { e.preventDefault(); handleDropOnLine(); }}
              >
                <span className={styles.todayLineHandle} aria-hidden="true">
                  <GripVerticalIcon />
                </span>
                <span className={styles.todayLineLabel}>End of today</span>
              </div>
              {laterItems.length > 0 && (
                <>
                  <h3 id="todo-later-heading" className={styles.todoGroupHeading}>Later</h3>
                  <ul data-testid="todo-later-list" className={styles.todoList} aria-labelledby="todo-later-heading">
                    {laterItems.map(renderOpenItem)}
                  </ul>
                </>
              )}
              {draggingLine && (
                <div
                  data-testid="todo-list-end"
                  className={styles.todoListEndZone}
                  onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; }}
                  onDrop={(e) => { e.preventDefault(); handleDropAtEnd(); }}
                >
                  Drop here to make everything today
                </div>
              )}
            </>
          )}
          {doneItems.length > 0 && (
            <div className={styles.todoDoneSection}>
              <button
                className={styles.todoDoneToggle}
                onClick={() => setDoneOpen((o) => !o)}
                aria-expanded={doneOpen}
                aria-controls="todo-done-list"
              >
                Done ({doneItems.length})
              </button>
              {doneOpen && (
                <ul id="todo-done-list" className={styles.todoDoneList}>
                  {doneItems.map((item) => (
                    <li key={item.itemId} className={clsx(styles.todoItem, styles.todoItemDone)}>
                      <div className={styles.todoItemContent}>
                        <span className={styles.todoDescription}>{item.description}</span>
                        {item.noteTitle && <span className={styles.todoNoteTitle}>{item.noteTitle}</span>}
                      </div>
                      <button
                        className={styles.todoReopenBtn}
                        aria-label={`Reopen "${item.description}"`}
                        disabled={busy.has(item.itemId)}
                        onClick={() => void handleReopen(item)}
                      >
                        Reopen
                      </button>
                      <button
                        className="icon-btn icon-btn--danger"
                        aria-label={`Delete "${item.description}"`}
                        disabled={busy.has(item.itemId)}
                        onClick={() => void handleDelete(item)}
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
