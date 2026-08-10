import { useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { useEffect, useRef, useState } from "react";
import { keys } from "../api/queryKeys";
import { TodoItem, TodoListData } from "../api/todos";
import { useCompleteTodo, useReopenTodo, useEditTodo, useDeleteTodo, useReorderTodos, useSetTodayLine } from "../hooks/useTodoMutations";
import { useTodos } from "../hooks/useTodos";
import { TrashIcon, GripVerticalIcon } from "./icons";
import QuickCaptureTodoInput from "./QuickCaptureTodoInput";
import RowMenu from "./RowMenu";
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

// CSS.escape: item ids are server-supplied, and a quote in one would make this selector throw
// rather than simply miss.
function focusRowMenu(itemId: string) {
  document
    .querySelector<HTMLButtonElement>(`[data-menu-trigger="${CSS.escape(itemId)}"]`)
    ?.focus();
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
  // 50-B: only one row's actions menu is open at a time, so the open row is list state.
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  // Crossing the line moves the row between two DIFFERENT <ul>s, so React unmounts and
  // remounts it — RowMenu's own focus-restore points at a detached node. Re-find the new
  // trigger after the re-render instead, or a keyboard user is dumped back to the body.
  const refocusMenuRef = useRef<string | null>(null);
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

  // Keyed on the rendered order, NOT left dep-less: react-query applies the optimistic cache
  // write in a microtask, so the first render after the click is the busy-flag one and still
  // shows the row in its old group. A dep-less effect would focus that about-to-be-discarded
  // node and clear the ref, and the real remount would then drop focus to <body>.
  // Only ever calls .focus() — no setState, which would trip react-hooks/set-state-in-effect.
  const renderedOrderKey = `${openItems.map((i) => i.itemId).join(",")}|${anchorItemId ?? ""}`;
  useEffect(() => {
    const id = refocusMenuRef.current;
    if (id === null) return;
    refocusMenuRef.current = null;
    focusRowMenu(id);
  }, [renderedOrderKey]);

  // Every Today-line move goes through here. The optimistic update means a failed save would
  // otherwise just snap the line back with no explanation — say so instead.
  // Reports failure instead of announcing it, so a caller that pairs this write with another
  // can roll BOTH back and speak once rather than emitting two half-truths.
  async function setLineAsync(anchor: string | null): Promise<boolean> {
    try {
      await setLine.mutateAsync(anchor);
      return true;
    } catch {
      return false;
    }
  }

  async function moveLineAsync(anchor: string | null) {
    if (!(await setLineAsync(anchor))) {
      showError("Couldn't move the Today line. It's back where it was.");
    }
  }

  // Fire-and-forget for the drag/keyboard paths, where nothing waits on the write landing.
  function moveLine(anchor: string | null) {
    void moveLineAsync(anchor);
  }

  // Reorder the open items, optimistically and persisted. Pass the full new id order.
  // BUG-63: order is a property of the WHOLE list, so two overlapping reorders are never safe —
  // each snapshots the cache in onMutate, and a rollback then restores a snapshot taken before the
  // other applied, leaving the UI showing an order the server never stored (staleTime 30s +
  // refetchOnWindowFocus off = never corrected). Guarding here rather than in a caller covers every
  // entry point at once: send-to-top/bottom, drag-drop onto a row, and drop onto the Today line.
  // Returns whether the new order actually persisted — 50-B's cross-the-line move pairs a
  // reorder with a line write, and must put the line back if the reorder rolled back.
  async function reorderTo(orderedIds: string[]): Promise<boolean> {
    if (reorder.isPending) return false;
    if (orderedIds.length < 2) return false;
    setReorderError(null);
    try {
      await reorder.mutateAsync(orderedIds);
      return true;
    } catch {
      setReorderError("Failed to reorder to-dos. Please try again.");
      return false;
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
  // BUG-63: the send buttons were disabled only by POSITION, so two DIFFERENT rows stayed clickable
  // back-to-back and fired concurrent reorders. Each mutation snapshots the cache in onMutate, so a
  // rollback restores a snapshot taken before the other applied — and with no reconcile the UI keeps
  // an order the server never stored.
  // The guard is `reorder.isPending`, NOT the per-item `busy` set: order is a property of the WHOLE
  // list, so one row being busy says nothing about another row. A per-item lock leaves exactly the
  // reported hole open (row A saving, row B still clickable) — the regression test below proves it.
  async function sendTo(item: TodoItem, edge: "top" | "bottom") {
    if (reorder.isPending || busy.has(item.itemId)) return;
    const ids = openItems.map((i) => i.itemId);
    const from = ids.indexOf(item.itemId);
    const to = edge === "top" ? 0 : ids.length - 1;
    if (from < 0 || from === to) return;
    const nextIds = arrayMove(ids, from, to);
    // Sending a Later row to the top remounts it into the Today <ul>, so the menu's own
    // focus-restore would land on a detached node — same hazard as moveAcrossLine.
    refocusMenuRef.current = item.itemId;
    addBusy(item.itemId);
    try {
      // Kick off the save, then re-anchor in the SAME tick before awaiting, preserving the
      // original ordering: the line must move with the row optimistically, not after the round trip.
      const saved = reorderTo(nextIds);
      // 50-A: sending the ANCHOR itself to an edge would drag the line with it — to the top empties
      // Today, to the bottom promotes everything. Re-anchor so the line stays where the user put it.
      reanchorIfLineWouldFollow(item.itemId, nextIds);
      await saved;
    } finally {
      removeBusy(item.itemId);
    }
  }

  // Where the line ends up after a cross-the-line move.
  //   Demoting re-anchors the line ONTO the moved row — that is what makes it the first Later item.
  //   Promoting the ANCHOR itself would otherwise drag the line along and swallow everything below
  //   it, so the line steps down to the next Later row (null once nothing is left below).
  //   Promoting any other row leaves the line alone.
  function anchorAfterMove(item: TodoItem, goingToLater: boolean): string | null {
    if (goingToLater) return item.itemId;
    if (item.itemId !== anchorItemId) return anchorItemId;
    return laterItems[1]?.itemId ?? null;
  }

  // 50-B: cross the line in one action, no drag. Promoting lands the row LAST in Today
  // (directly above the line) so it never jumps ahead of what the user already prioritised;
  // demoting lands it FIRST in Later.
  async function moveAcrossLine(item: TodoItem) {
    if (reorder.isPending || busy.has(item.itemId)) return;
    const ids = openItems.map((i) => i.itemId);
    const from = ids.indexOf(item.itemId);
    if (from < 0) return;

    const goingToLater = from < splitAt;
    const to = goingToLater ? splitAt - 1 : splitAt;
    const nextIds = from === to ? ids : arrayMove(ids, from, to);
    const nextAnchor = anchorAfterMove(item, goingToLater);
    const needsReorder = nextIds !== ids;
    const needsLineMove = nextAnchor !== anchorItemId;

    refocusMenuRef.current = item.itemId;
    addBusy(item.itemId);
    try {
      setReorderError(null);
      // Both writes start in the same tick, so the row and the line move together optimistically
      // rather than the line lagging a round trip behind the row.
      const [orderOk, lineOk] = await Promise.all([
        needsReorder ? reorderTo(nextIds) : Promise.resolve(true),
        needsLineMove ? setLineAsync(nextAnchor) : Promise.resolve(true),
      ]);
      if (orderOk && lineOk) return;
      // One user action, up to TWO appends — so a half-failure can leave one of them PERSISTED.
      // Restoring a client snapshot here would be two lies at once: it would claim the move was
      // undone when the server disagrees, and it would clobber anything else written during the
      // round trip (a completion, a quick-add — neither is gated on this row's busy flag).
      // Refetch instead and show whatever actually landed.
      refocusMenuRef.current = item.itemId;
      setReorderError("Couldn't finish moving that to-do. The list has been refreshed.");
      await qc.invalidateQueries({ queryKey: keys.todos });
      // The refetch may land on the same order the effect already reacted to, in which case
      // renderedOrderKey never changes and the effect never fires — restore focus directly.
      focusRowMenu(item.itemId);
    } finally {
      removeBusy(item.itemId);
    }
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
    // Order is a property of the WHOLE list, so an in-flight reorder locks every row's
    // reorder actions, not just the one being saved (BUG-63).
    const rowLocked = busy.has(item.itemId) || reorder.isPending;
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
        {/* 50-B: the reorder actions live in one menu so the row stays legible. Delete does
            NOT — it is destructive and unconfirmed, so it stays visible and one click away. */}
        <RowMenu
          label={`Actions for "${item.description}"`}
          triggerId={item.itemId}
          open={openMenuId === item.itemId}
          onOpenChange={(next) => setOpenMenuId(next ? item.itemId : null)}
          actions={[
            {
              label: openIndex < splitAt ? "Move to Later" : "Move to Today",
              run: () => void moveAcrossLine(item),
              disabled: rowLocked,
            },
            {
              label: "Send to top",
              run: () => void sendTo(item, "top"),
              disabled: openIndex === 0 || rowLocked,
            },
            {
              label: "Send to bottom",
              run: () => void sendTo(item, "bottom"),
              disabled: openIndex === openItems.length - 1 || rowLocked,
            },
          ]}
        />
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
