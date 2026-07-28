import clsx from "clsx";
import type { OpenNoteTab } from "../hooks/useOpenNoteTabs";
import styles from "./OpenNoteTabs.module.css";

// 49-A: the notes the user has open, one visible at a time.
//
// Not ARIA tabs: `role="tab"` obliges a matching `role="tabpanel"`, and the panel here is
// the note screen's own <main> landmark — relabelling that would be worse for a screen
// reader than plain navigation. A labelled <nav> of buttons with `aria-current="page"` on
// the active one says the same thing, and native buttons give keyboard order for free.
export default function OpenNoteTabs({
  tabs,
  activeNoteId,
  onSelect,
  onClose,
}: {
  tabs: OpenNoteTab[];
  activeNoteId?: string;
  onSelect: (noteId: string) => void;
  onClose: (noteId: string) => void;
}) {
  if (tabs.length === 0) return null;
  return (
    <nav data-testid="open-note-tabs" aria-label="Open notes" className={styles.bar}>
      <ul className={styles.list}>
        {tabs.map((tab) => {
          const isActive = tab.noteId === activeNoteId;
          return (
            <li
              key={tab.noteId}
              data-testid="open-note-tab"
              data-note-id={tab.noteId}
              className={clsx(styles.tab, isActive && styles.tabActive)}
            >
              <button
                type="button"
                data-testid="open-note-tab-label"
                className={styles.label}
                aria-current={isActive ? "page" : undefined}
                title={tab.title}
                onClick={() => onSelect(tab.noteId)}
              >
                {tab.title}
              </button>
              <button
                type="button"
                data-testid="open-note-tab-close"
                className={styles.close}
                aria-label={`Close ${tab.title}`}
                onClick={() => onClose(tab.noteId)}
              >
                <span aria-hidden="true">×</span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
