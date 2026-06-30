import { useState } from "react";
import { useAddAgendaItem, useSetAgendaItemDiscussed } from "../hooks/useAgendaMutations";
import { useNoteDetail } from "../hooks/useNoteDetail";
import styles from "./AgendaSection.module.css";

// Phase 43-A/B: the meeting agenda lives in the note header (with the title), expanded. 43-A added
// add + display; 43-B adds tick/untick (2-state) + a "X / Y" coverage count. Edit/remove is 43-C,
// collapse is 43-D. Items show in capture order; add and tick are both optimistic (the change shows
// immediately, before the API responds). Reads the agenda from the shared note-detail cache (like
// ActionsSection reads useActions) so the optimistic cache patch reflects here without prop-drilling.
export default function AgendaSection({ noteId }: { noteId: string }) {
  const { data: detail } = useNoteDetail(noteId);
  const agenda = detail?.agenda ?? [];
  const addItem = useAddAgendaItem();
  const setDiscussed = useSetAgendaItemDiscussed();
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
        <span className={styles.coverage} data-testid="agenda-coverage">
          {done} / {agenda.length}
        </span>
      )}
      <ul className={styles.items}>
        {agenda.map((item) => (
          <li key={item.itemId} className={styles.item} data-testid="agenda-item">
            <label className={styles.itemLabel}>
              <input
                type="checkbox"
                className={styles.check}
                checked={item.discussed}
                onChange={(e) => setDiscussed.mutate({ noteId, itemId: item.itemId, discussed: e.target.checked })}
                aria-label={`Mark "${item.text}" discussed`}
                data-testid="agenda-item-check"
              />
              <span className={item.discussed ? styles.itemTextDone : styles.itemText}>{item.text}</span>
            </label>
          </li>
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
