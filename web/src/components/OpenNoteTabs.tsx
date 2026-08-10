import clsx from "clsx";
import type { OpenNoteTab } from "../hooks/useOpenNoteTabs";
import styles from "./OpenNoteTabs.module.css";

// 49-A: the notes the user has open, one visible at a time.
//
// Not ARIA tabs: `role="tab"` obliges a matching `role="tabpanel"`, and the panel here is
// the note screen's own <main> landmark — relabelling that would be worse for a screen
// reader than plain navigation. A labelled <nav> of buttons with `aria-current="page"` on
// the active one says the same thing, and native buttons give keyboard order for free.
//
// 51-B: the bar is PERMANENT. It renders on every screen and never returns null. The notes
// list is a pinned leftmost tab, current whenever no note is open, so nothing in the bar
// ever appears or disappears — the flicker of going Home and coming back was the whole
// reason for the redesign. The pinned tab is deliberately NOT `data-testid="open-note-tab"`:
// counting it would shift every count assertion by one, and the E2E helper that closes
// stray tabs loops on that testid clicking a close button the pinned tab does not have,
// which would hang the suite rather than fail it.
export default function OpenNoteTabs({
  tabs,
  activeNoteId,
  homeIsCurrentPage,
  reconciled,
  onSelect,
  onSelectHome,
  onClose,
}: {
  tabs: OpenNoteTab[];
  activeNoteId?: string;
  // `aria-current="page"` only when the pinned tab really IS the current page. On a folder
  // or search screen the notes list is the current ITEM in the bar but not the page you are
  // on — and clicking it navigates away — so that case gets `aria-current="true"`.
  homeIsCurrentPage: boolean;
  // 49-B: false until a note-cards read has succeeded. Restored tabs render straight from
  // storage before that, so the set on screen is provisional and one may still drop when the
  // list lands. Surfaced as an attribute because that transition is otherwise unobservable:
  // an E2E count assertion is a coin toss without something to wait on, and "the response
  // arrived" is not the same as "the reconciled set rendered".
  //
  // 51-B: this now matters on every route, not just the note route — the set is provisional
  // on the notes list for exactly the same reason.
  reconciled: boolean;
  onSelect: (noteId: string) => void;
  onSelectHome: () => void;
  onClose: (noteId: string) => void;
}) {
  return (
    <nav
      data-testid="open-note-tabs"
      data-tabs-reconciled={reconciled ? "true" : "false"}
      aria-label="Open notes"
      className={styles.bar}
    >
      <ul className={styles.list}>
        <li className={clsx(styles.tab, styles.tabHome, !activeNoteId && styles.tabActive)}>
          <button
            type="button"
            data-testid="open-note-tab-home"
            className={styles.label}
            aria-current={activeNoteId ? undefined : homeIsCurrentPage ? "page" : "true"}
            onClick={onSelectHome}
          >
            <HomeIcon />
            My notes
          </button>
        </li>
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

function HomeIcon() {
  return (
    <svg
      className={styles.homeIcon}
      viewBox="0 0 16 16"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2 6.5 8 2l6 4.5V13a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6.5Z" />
    </svg>
  );
}
