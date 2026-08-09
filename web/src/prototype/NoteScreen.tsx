// Prototype only — throwaway.
//
// 51-A scope (corrected 2026-08-09): the note's own tab strip is NOT changing.
// It is rendered here exactly as it ships today, in every direction, so the
// top-level bar is judged against the real screen rather than a blank one.
import clsx from "clsx";
import { useState } from "react";
import { NOTES, QUICK_LINES } from "./data";
import s from "./prototype.module.css";

export default function NoteScreen({ noteId }: { noteId: string }) {
  const [tab, setTab] = useState<"quick" | "transcript" | "final">("quick");
  const note = NOTES.find((n) => n.id === noteId) ?? NOTES[0];

  return (
    <div className={s.screen}>
      <h1 className={s.noteTitle}>{note.title}</h1>
      <div className={s.noteMeta}>{note.meta} · Linked to <strong>Northwind weekly</strong></div>

      <div className={s.tabRow}>
        <div className={s.underlineTabs}>
          {(["quick", "transcript", "final"] as const).map((t) => (
            <button
              key={t}
              type="button"
              className={clsx(s.uTab, tab === t && s.uTabOn)}
              onClick={() => setTab(t)}
            >
              {t === "quick" ? "Quick notes" : t === "transcript" ? "Transcript" : "Final notes"}
            </button>
          ))}
        </div>
        <div className={s.rowControls}>
          <button type="button" className={s.ghostBtn}>Paste transcript</button>
          <button type="button" className={s.recBtn}>Record</button>
        </div>
      </div>

      <div className={s.panel}>
        <div className={s.panelLabel}>
          {tab === "quick" ? "Captured notes" : tab === "transcript" ? "Transcript" : "Final notes"}
        </div>
        <div className={s.body}>
          <ul>{QUICK_LINES.map((l) => <li key={l}>{l}</li>)}</ul>
        </div>
      </div>
    </div>
  );
}
