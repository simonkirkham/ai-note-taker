import { useState } from "react";
import { useAddAgendaItem } from "../hooks/useAgendaMutations";
import { useNoteDetail } from "../hooks/useNoteDetail";
import styles from "./AgendaSection.module.css";

// Phase 43-A: the meeting agenda lives in the note header (with the title), expanded. This slice
// is add + display only — tick/coverage is 43-B, edit/remove is 43-C, collapse is 43-D. Items show
// in capture order; adding is optimistic (the item appears immediately, before the API responds).
// Reads the agenda from the shared note-detail cache (like ActionsSection reads useActions) so the
// optimistic cache patch reflects here without prop-drilling; React Query dedupes the query key.
export default function AgendaSection({ noteId }: { noteId: string }) {
  const { data: detail } = useNoteDetail(noteId);
  const agenda = detail?.agenda ?? [];
  const addItem = useAddAgendaItem();
  const [text, setText] = useState("");

  function submit() {
    const trimmed = text.trim();
    if (!trimmed) return;
    addItem.mutate({ noteId, text: trimmed, tempId: `temp-${crypto.randomUUID()}` });
    setText("");
  }

  return (
    <div className={styles.agenda} data-testid="agenda-section" role="group" aria-label="Agenda">
      <span className={styles.label}>Agenda</span>
      <div className={styles.items}>
        {agenda.map((item) => (
          <span key={item.itemId} className={styles.item} data-testid="agenda-item">
            {item.text}
          </span>
        ))}
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
      </div>
    </div>
  );
}
