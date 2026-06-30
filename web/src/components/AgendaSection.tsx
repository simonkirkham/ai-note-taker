import { useEffect, useRef, useState } from "react";
import type { AgendaItem } from "../api/notes";
import {
  useAddAgendaItem,
  useEditAgendaItemText,
  useRemoveAgendaItem,
  useSetAgendaItemDiscussed,
} from "../hooks/useAgendaMutations";
import { useNoteDetail } from "../hooks/useNoteDetail";
import styles from "./AgendaSection.module.css";

// Phase 43-A/B/C: the meeting agenda lives in the note header (with the title), expanded. 43-A added
// add + display; 43-B added tick/untick (2-state) + a "X / Y" coverage count; 43-C adds inline edit
// of an item's text and remove. Collapse is 43-D. Items show in capture order; every mutation is
// optimistic (the change shows immediately, before the API responds). Reads the agenda from the
// shared note-detail cache (like ActionsSection reads useActions) so optimistic patches reflect here.
export default function AgendaSection({ noteId }: { noteId: string }) {
  const { data: detail } = useNoteDetail(noteId);
  const agenda = detail?.agenda ?? [];
  const addItem = useAddAgendaItem();
  const [text, setText] = useState("");

  const done = agenda.filter((a) => a.discussed).length;

  function submit() {
    const trimmed = text.trim();
    if (!trimmed) return;
    addItem.mutate({ noteId, text: trimmed, tempId: `temp-${crypto.randomUUID()}` });
    setText("");
  }

  return (
    <div className={styles.agenda} data-testid="agenda-section" role="group" aria-label="Agenda">
      <span className={styles.label}>Agenda</span>
      {agenda.length > 0 && (
        <span
          className={styles.coverage}
          data-testid="agenda-coverage"
          aria-label={`${done} of ${agenda.length} agenda items covered`}
        >
          {done} / {agenda.length}
        </span>
      )}
      <ul className={styles.items}>
        {agenda.map((item) => (
          <AgendaItemRow key={item.itemId} noteId={noteId} item={item} />
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
    </div>
  );
}

function AgendaItemRow({ noteId, item }: { noteId: string; item: AgendaItem }) {
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
    editText.mutate({ noteId, itemId: item.itemId, text: trimmed });
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
        onChange={(e) => setDiscussed.mutate({ noteId, itemId: item.itemId, discussed: e.target.checked })}
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
          aria-label={`Edit "${item.text}"`}
          data-testid="agenda-item-text"
        >
          {item.text}
        </button>
      )}
      <button
        type="button"
        className={styles.remove}
        onClick={() => removeItem.mutate({ noteId, itemId: item.itemId })}
        aria-label={`Remove "${item.text}"`}
        data-testid="agenda-item-remove"
      >
        ×
      </button>
    </li>
  );
}
