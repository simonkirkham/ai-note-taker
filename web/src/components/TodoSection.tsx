import { useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { useRef, useState } from "react";
import { keys } from "../api/queryKeys";
import { TodoItem, TodoListData } from "../api/todos";
import { useCompleteTodo, useReopenTodo, useEditTodo, useDeleteTodo, useReorderTodos, useSetTodayLine } from "../hooks/useTodoMutations";
import { useTodos } from "../hooks/useTodos";
import { TrashIcon, GripVerticalIcon, SendToTopIcon, SendToBottomIcon } from "./icons";
import QuickCaptureTodoInput from "./QuickCaptureTodoInput";
import { useToast } from "./toastContext";
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
  const { showError } = useToast();
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
  // CHANGE-34: a failed reorder must not be silent — the optimistic move would otherwise just
  // snap back with no explanation. Same reasoning as the Today-line toast above.
  const [reorderError, setReorderError] = useState<string | null>(null);
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

  // Every Today-line move goes through here. The optimistic update means a failed save would
  // otherwise just snap the line back with no explanation — say so instead.
  async function moveLineAsync(anchor: string | null) {
    try {
      await setLine.mutateAsync(anchor);
    } catch {
      showError("Couldn't move the Today line. It's back where it was.");
    }
  }

  // Fire-and-forget for the drag/keyboard paths, where nothing waits on the write landing.
  function moveLine(anchor: string | null) {
    void moveLineAsync(anchor);
  }

  // Reorder the open items, optimistically and persisted. Pass the full new id order.
  async function reorderTo(orderedIds: string[]) {
    if (orderedIds.length < 2) return;
    setReorderError(null);
    try {
      await reorder.mutateAsync(orderedIds);
    } catch {
      setReorderError("Failed to reorder to-dos. Please try again.");
    }
  }

  function handleDrop(targetId: string) {
    const ids = openItems.map((i) => i.itemId);
    const dragged = draggedId;
    setDraggedId(null);
    // Dropping the line on a row puts the line immediately above that row.
    if (dragged === TODAY_LINE_DRAG_ID) {
      if (targetId !== anchorItemId) moveLine(targetId);
      return;
    }
    if (dragged === null) return;
    const from = ids.indexOf(dragged);
    const to = ids.indexOf(targetId);
    if (from < 0 || to < 0 || from === to) return;
    const nextIds = arrayMove(ids, from, to);
    void reorderTo(nextIds);
    reanchorIfLineWouldFollow(dragged, nextIds);
  }

  // The line is anchored to an item ID, so dragging the ANCHOR ITSELF would drag the line with it —
  // pulling the anchor to the top would empty Today, pushing it to the bottom would promote
  // everything. The line must stay put: re-anchor it to whichever item now heads the old Later
  // group (null if the dragged item was the only one left below the line).
  function reanchorIfLineWouldFollow(draggedItemId: string, nextIds: string[]) {
    if (draggedItemId !== anchorItemId) return;
    const stillLater = new Set(
      openItems.slice(splitAt).map((i) => i.itemId).filter((id) => id !== draggedItemId),
    );
    const newAnchor = nextIds.find((id) => stillLater.has(id)) ?? null;
    if (newAnchor !== anchorItemId) moveLine(newAnchor);
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
    // Dropping the anchor itself on the line moves it into Today: the order is unchanged and only
    // the line steps down past it.
    if (dragged === anchorItemId) {
      reanchorIfLineWouldFollow(dragged, ids);
      return;
    }
    const to = from < splitAt ? splitAt - 1 : splitAt;
    if (from === to) return;
    void reorderTo(arrayMove(ids, from, to));
  }

  // CHANGE-34: jump an item to either end of the open list without a long drag — and the only
  // keyboard-operable reorder path (CHANGE-29 removed the up/down arrows). "Top" lands it in
  // Today, "bottom" in Later, since the groups are just the list either side of the line.
  function sendTo(item: TodoItem, edge: "top" | "bottom") {
    const ids = openItems.map((i) => i.itemId);
    const from = ids.indexOf(item.itemId);
    const to = edge === "top" ? 0 : ids.length - 1;
    if (from < 0 || from === to) return;
    const nextIds = arrayMove(ids, from, to);
    void reorderTo(nextIds);
    // 50-A: sending the ANCHOR itself to an edge would drag the line with it — to the top empties
    // Today, to the bottom promotes everything. Re-anchor so the line stays where the user put it.
    reanchorIfLineWouldFollow(item.itemId, nextIds);
  }

  // Keyboard equivalent of dragging the line: step it over the item above or below.
  function moveLineByKeyboard(direction: -1 | 1) {
    if (direction === -1) {
      if (splitAt === 0) return;
      moveLine(openItems[splitAt - 1].itemId);
      return;
    }
    if (anchorItemId === null) return;
    moveLine(openItems[splitAt + 1]?.itemId ?? null);
  }

  // The zone past the last row: the only way to send the line back below everything.
  function handleDropAtEnd() {
    const dragged = draggedId;
    setDraggedId(null);
    if (dragged === TODAY_LINE_DRAG_ID && anchorItemId !== null) moveLine(null);
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
    // A fresh item has no stored Position, and the server sorts unpositioned rows LAST — so
    // without persisting an order the new to-do jumps to the bottom on the next refetch, landing
    // under "Later". Pin the order we just rendered.
    const openIds = (qc.getQueryData<TodoListData>(keys.todos)?.items ?? [])
      .filter((i) => i.completedAt === null)
      .map((i) => i.itemId);
    if (openIds.length > 1) reorder.mutate(openIds);
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
      // Deleting the ANCHOR leaves the line with nothing to hang off: the optimistic cache update
      // drops it below everything and promotes the whole list to Today until a refetch lands. So
      // step the line down first, exactly as dragging the anchor away does (reanchorIfLineWouldFollow).
      // Awaited so the stored anchor never points at a deleted row — but non-fatal, because a failed
      // line move must not swallow the delete the user actually asked for. The projector relocates a
      // deleted anchor too (covering the note Actions panel and other devices); it no-ops here
      // because this write lands first and leaves it nothing to relocate.
      if (item.itemId === anchorItemId) await moveLineAsync(openItems[splitAt + 1]?.itemId ?? null);
      await remove.mutateAsync(item);
    } catch {
      // rolled back in onError
    } finally {
      removeBusy(item.itemId);
    }
  }

  function renderOpenItem(item: TodoItem) {
    // Position in the FULL open list. renderOpenItem is mapped over todayItems/laterItems
    // separately, so the map's own index would be group-relative and would mis-disable the
    // send buttons for every Later row.
    const openIndex = openItems.findIndex((i) => i.itemId === item.itemId);
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
        <div className={styles.todoSendButtons}>
          <button
            type="button"
            className="icon-btn"
            aria-label={`Send "${item.description}" to top`}
            title="Send to top"
            disabled={openIndex === 0 || busy.has(item.itemId)}
            onClick={() => sendTo(item, "top")}
          >
            <SendToTopIcon />
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label={`Send "${item.description}" to bottom`}
            title="Send to bottom"
            disabled={openIndex === openItems.length - 1 || busy.has(item.itemId)}
            onClick={() => sendTo(item, "bottom")}
          >
            <SendToBottomIcon />
          </button>
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
              {/* A FOCUSABLE separator is the ARIA window-splitter widget, not decoration: it takes
                  a tabIndex, reports its position with aria-valuenow, and is moved with the arrow
                  keys. Both rules below treat `separator` as always non-interactive, which holds
                  only for a static divider — this one is genuinely a control. */}
              {/* eslint-disable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex */}
              <div
                data-testid="today-line"
                role="separator"
                aria-orientation="horizontal"
                aria-valuenow={todayItems.length}
                aria-valuemin={0}
                aria-valuemax={openItems.length}
                aria-label={`End of today — ${todayItems.length} in today, ${laterItems.length} later. Use the arrow keys to move.`}
                title="Drag, or focus and use the arrow keys, to move where today ends"
                tabIndex={0}
                className={clsx(styles.todayLine, draggingLine && styles.todayLineDragging)}
                draggable
                onDragStart={() => setDraggedId(TODAY_LINE_DRAG_ID)}
                onDragEnd={() => setDraggedId(null)}
                onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; }}
                onDrop={(e) => { e.preventDefault(); handleDropOnLine(); }}
                onKeyDown={(e) => {
                  if (e.key === "ArrowUp") { e.preventDefault(); moveLineByKeyboard(-1); }
                  if (e.key === "ArrowDown") { e.preventDefault(); moveLineByKeyboard(1); }
                }}
              >
                <span className={styles.todayLineHandle} aria-hidden="true">
                  <GripVerticalIcon />
                </span>
                <span className={styles.todayLineLabel}>End of today</span>
              </div>
              {/* eslint-enable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex */}
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
          {reorderError && <p className={styles.todoReorderError} role="alert">{reorderError}</p>}
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
