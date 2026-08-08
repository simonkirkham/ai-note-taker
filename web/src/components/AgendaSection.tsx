import { useEffect, useRef, useState } from "react";
import type { AgendaItem } from "../api/notes";
import {
  useAddAgendaItem,
  useEditAgendaItemText,
  useRemoveAgendaItem,
  useSetAgendaItemDiscussed,
} from "../hooks/useAgendaMutations";
import { useNoteDetail } from "../hooks/useNoteDetail";
import type { AgendaEditorApi } from "../lib/agendaEditorApi";
import styles from "./AgendaSection.module.css";

// Phase 43-A/B/C/D: the meeting agenda lives in the note header (with the title), expanded by
// default. 43-A add+display; 43-B tick/untick + "X / Y" coverage; 43-C inline edit + remove; 43-D
// makes the strip collapsible — collapsed it shows one line (the "Agenda" label, the "X / Y"
// coverage pill, and a peek of the remaining open items) and costs no side space in either state
// (the note body stays full-width below). The
// collapse toggle only appears once there are items (nothing to fold on an empty agenda). Every
// mutation is optimistic; the agenda is read from the shared note-detail cache.
export default function AgendaSection({
  noteId,
  editor,
}: {
  noteId: string;
  // 43-G: the live editor's command object, or null while the lazy editor chunk is still loading.
  // A topic derived from the note body is a task-list line, so adding/ticking/rewording/removing it
  // is a document edit — undoable with Ctrl+Z, and applied to the document that holds unsaved
  // typing. Legacy topics (pre-43-F, carried by AgendaItem* events) still go through the API until
  // 43-H migrates them into their notes; that is why both paths exist here.
  editor?: AgendaEditorApi | null;
}) {
  const { data: detail } = useNoteDetail(noteId);
  const agenda = detail?.agenda ?? [];
  const addItem = useAddAgendaItem();
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
    // Editor not mounted yet (lazy chunk still loading) — fall back to the legacy path rather than
    // dropping the user's typing on the floor.
    addItem.mutate({ noteId, text: trimmed, tempId: `temp-${crypto.randomUUID()}` });
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
            <AgendaItemRow key={item.itemId} noteId={noteId} item={item} editor={editor} />
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
              placeholder="+ add item…"
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
  noteId,
  item,
  editor,
}: {
  noteId: string;
  item: AgendaItem;
  editor?: AgendaEditorApi | null;
}) {
  // A derived topic is editable only while the editor is live; a legacy one always uses the API.
  // Held as a narrowed value rather than a boolean so TypeScript proves it non-null at each call
  // site (lint forbids non-null assertions, and rightly — the null case is real here).
  const api = item.derived === true ? (editor ?? null) : null;
  const setDiscussed = useSetAgendaItemDiscussed();
  const editText = useEditAgendaItemText();
  const removeItem = useRemoveAgendaItem();
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
    // Empty or unchanged → don't send a write (the backend rejects blank with 400, and an
    // unchanged edit is a pointless event); just reconcile the field back to the current text.
    if (!trimmed || trimmed === item.text) return;
    if (api) api.setTopicText(item.position, trimmed);
    else editText.mutate({ noteId, itemId: item.itemId, text: trimmed });
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
        // 43-F: a derived topic is a task-list line in the note body — the body owns its ticked
        // state, so tick it there. The agenda-item endpoints have no event stream for it and would
        // 404. 43-G makes these controls write back through the editor.
        // 43-G: a derived topic is now tickable from here — the change is applied to its line in
        // the note. Disabled only while the editor has not loaded, since there is nothing to write to.
        disabled={item.derived === true && editor == null}
        onChange={(e) => {
          if (api) api.setTopicChecked(item.position, e.target.checked);
          else setDiscussed.mutate({ noteId, itemId: item.itemId, discussed: e.target.checked });
        }}
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
          disabled={item.derived === true && editor == null}
          aria-label={`Edit "${item.text}"`}
          data-testid="agenda-item-text"
        >
          {item.text}
        </button>
      )}
      {(item.derived !== true || editor != null) && (
        <button
          type="button"
          className={styles.remove}
          onClick={() => {
            if (api) api.removeTopic(item.position);
            else removeItem.mutate({ noteId, itemId: item.itemId });
          }}
          aria-label={`Remove "${item.text}"`}
          data-testid="agenda-item-remove"
        >
          ×
        </button>
      )}
    </li>
  );
}
