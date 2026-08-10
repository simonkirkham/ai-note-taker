import { useEffect, useRef, useState } from "react";
import type { AgendaItem } from "../api/notes";
import { useNoteDetail } from "../hooks/useNoteDetail";
import type { AgendaEditorApi, LiveTopic } from "../lib/agendaEditorApi";
import styles from "./AgendaSection.module.css";

// Phase 43-A/B/C/D: the meeting agenda lives in the note header (with the title), expanded by
// default. 43-A add+display; 43-B tick/untick + "X / Y" coverage; 43-C inline edit + remove; 43-D
// makes the strip collapsible — collapsed it shows one line (the "Agenda" label, the "X / Y"
// coverage pill, and a peek of the remaining open items) and costs no side space in either state
// (the note body stays full-width below). The
// collapse toggle only appears once there are items (nothing to fold on an empty agenda).
//
// 43-H2: there is one source. A topic IS a task-list line in the note body, so every add, tick,
// reword and remove is a document edit through the editor — not a request. The projection is read
// only as a load-time fallback, while the lazy editor chunk is still arriving.
export default function AgendaSection({
  noteId,
  editor,
  liveTopics,
}: {
  noteId: string;
  // 43-G: the live editor's command object, or null while the lazy editor chunk is still loading.
  // A topic derived from the note body is a task-list line, so adding/ticking/rewording/removing it
  // is a document edit — undoable with Ctrl+Z, and applied to the document that holds unsaved
  // typing. Since 43-H2 this is the only path: with no editor there is nothing to write to, so the
  // controls are inert rather than silently dropping the change.
  editor?: AgendaEditorApi | null;
  // The topics as they exist in the live document, re-published on every keystroke. When present
  // these WIN over the server projection: rendering from the same document the commands act on is
  // the only way the index the header holds and the index a command resolves can agree (they are
  // otherwise two orderings of two documents — a blockquoted checklist, an empty `- [ ] ` line, or
  // any unsaved typing desynchronises them, and a remove then deletes the wrong line). It is also
  // what makes a header action move the UI immediately.
  liveTopics?: LiveTopic[] | null;
}) {
  const { data: detail } = useNoteDetail(noteId);
  const projected = detail?.agenda ?? [];
  // 43-H2: every topic is read from the note body now, so there is one source. Topics come from
  // the live document when the editor is mounted, and fall back to the projection only while the
  // lazy chunk is loading.
  const agenda: AgendaItem[] =
    liveTopics?.map((t, i) => ({
      itemId: `live-${i}`,
      text: t.text,
      discussed: t.checked,
      position: i,
      derived: true,
    })) ?? projected;
  const [text, setText] = useState("");
  const [collapsed, setCollapsed] = useState(false);

  const done = agenda.filter((a) => a.discussed).length;
  const hasItems = agenda.length > 0;
  const remaining = agenda.filter((a) => !a.discussed).map((a) => a.text);

  function submit() {
    const trimmed = text.trim();
    if (!trimmed) return;
    setText("");
    // 43-G: a new topic is always a line in the note now (Q7 — it joins the first checklist, or
    // starts one at the top). No API call: the editor edit rides the existing content-save path.
    if (editor) {
      editor.addTopic(trimmed);
      return;
    }
    // Editor not mounted yet. There is no API to fall back to since 43-H2 removed those routes —
    // the input is disabled in this window, so this is unreachable in practice.
  }

  return (
    <div className={styles.agenda} data-testid="agenda-section" role="group" aria-label="Agenda">
      <div className={styles.head}>
        {hasItems ? (
          <button
            type="button"
            className={styles.toggle}
            onClick={() => setCollapsed((c) => !c)}
            aria-expanded={!collapsed}
            // Only reference the body while it's actually mounted (it unmounts when collapsed),
            // so aria-controls never points at a missing id.
            aria-controls={collapsed ? undefined : `agenda-body-${noteId}`}
            data-testid="agenda-toggle"
          >
            <span className={collapsed ? styles.caretCollapsed : styles.caret} aria-hidden="true">▾</span>
            <span className={styles.label}>Agenda</span>
          </button>
        ) : (
          <span className={styles.label}>Agenda</span>
        )}
        {hasItems && (
          <span
            className={styles.coverage}
            data-testid="agenda-coverage"
            aria-label={`${done} of ${agenda.length} agenda items covered`}
          >
            {done} / {agenda.length}
          </span>
        )}
        {collapsed && hasItems && (
          <span className={styles.peek} data-testid="agenda-peek">
            {remaining.length > 0 ? `left: ${remaining.join(", ")}` : "all covered ✓"}
          </span>
        )}
      </div>
      {!collapsed && (
        <ul className={styles.items} id={`agenda-body-${noteId}`} data-testid="agenda-body">
          {agenda.map((item) => (
            <AgendaItemRow key={item.itemId} item={item} editor={editor} />
          ))}
          <li className={styles.addRow}>
            <input
              type="text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  submit();
                }
              }}
              onBlur={submit}
              // readOnly, not disabled: a disabled input leaves the tab order, which breaks the
              // keyboard path from the title through the header into the tab list. readOnly keeps
              // it focusable and announced while still refusing input during the brief window
              // before the lazy editor chunk resolves.
              readOnly={editor == null}
              aria-disabled={editor == null}
              placeholder={editor == null ? "loading…" : "+ add item…"}
              className={styles.addInput}
              aria-label="Add agenda item"
              data-testid="agenda-add-input"
            />
          </li>
        </ul>
      )}
    </div>
  );
}

function AgendaItemRow({
  item,
  editor,
}: {
  item: AgendaItem;
  editor?: AgendaEditorApi | null;
}) {
  // 43-H2: a topic is a line in the note body, so it is editable exactly while the editor is live.
  // Held as a narrowed value rather than a boolean so TypeScript proves it non-null at each call
  // site (lint forbids non-null assertions, and rightly — the null case is real here).
  const api = editor ?? null;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.text);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus the edit field when entering edit mode (replaces autoFocus — jsx-a11y/no-autofocus).
  // Effect only calls focus(), never setState, so it doesn't trip react-hooks/set-state-in-effect.
  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  // editingRef guards the commit against the blur-on-unmount that fires in a REAL browser when the
  // edit input is removed (jsdom doesn't fire it, so this is unprovable in unit tests — mirrors the
  // proven ActionsSection guard). On Enter the keydown commits then clears the ref, so the unmount
  // blur is a no-op; on Escape we clear the ref first so the blur commits nothing (Esc truly cancels).
  const editingRef = useRef(false);

  function startEditing() {
    setDraft(item.text);
    editingRef.current = true;
    setEditing(true);
  }

  function commit() {
    if (!editingRef.current) return; // already committed (Enter) or cancelled (Escape) — suppress the unmount blur
    editingRef.current = false;
    setEditing(false);
    const trimmed = draft.trim();
    // Empty or unchanged → don't touch the document. A no-op setTopicText would still dirty it,
    // pushing an undo-stack entry and triggering a content save for a change the user did not make.
    if (!trimmed || trimmed === item.text) return;
    api?.setTopicText(item.position, trimmed);
  }

  function cancel() {
    editingRef.current = false;
    setEditing(false);
  }

  return (
    <li className={styles.item} data-testid="agenda-item">
      <input
        type="checkbox"
        className={styles.check}
        checked={item.discussed}
        // A topic IS a task-list line in the note body, so ticking it here edits that line.
        // Disabled only while the editor has not loaded — there is nothing to write to yet.
        disabled={editor == null}
        onChange={(e) => api?.setTopicChecked(item.position, e.target.checked)}
        aria-label={`Mark "${item.text}" discussed`}
        data-testid="agenda-item-check"
      />
      {editing ? (
        <input
          ref={inputRef}
          type="text"
          className={styles.editInput}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            } else if (e.key === "Escape") {
              e.preventDefault();
              cancel();
            }
          }}
          onBlur={commit}
          aria-label={`Edit agenda item "${item.text}"`}
          data-testid="agenda-item-edit-input"
        />
      ) : (
        <button
          type="button"
          className={item.discussed ? styles.itemTextDone : styles.itemText}
          onClick={startEditing}
          disabled={editor == null}
          aria-label={`Edit "${item.text}"`}
          data-testid="agenda-item-text"
        >
          {item.text}
        </button>
      )}
      {editor != null && (
        <button
          type="button"
          className={styles.remove}
          onClick={() => api?.removeTopic(item.position)}
          aria-label={`Remove "${item.text}"`}
          data-testid="agenda-item-remove"
        >
          ×
        </button>
      )}
    </li>
  );
}
