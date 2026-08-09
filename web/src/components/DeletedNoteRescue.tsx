import { useState } from 'react';
import { clearDeletedNote, useDeletedNoteRescue } from '../lib/deletedNoteRescue';
import styles from './DeletedNoteRescue.module.css';

// BUG-59: rendered by App above the router, NOT inside NoteView. Attempt 1 put it in the note's
// quick-notes tabpanel, which is `hidden` from the Transcript and Final tabs — so the one banner
// telling the user their text was rescued was invisible from the tab whose own button (Generate
// final notes) triggers a save. Here it is outside every tabpanel and outside the route, so it
// survives the navigation home that a deleted note now causes.
export default function DeletedNoteRescue() {
  const rescue = useDeletedNoteRescue();
  const [copied, setCopied] = useState(false);

  if (rescue === null) return null;

  async function handleCopy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      // Clipboard denied or unavailable (no secure context, permission refused). The text is
      // already on screen in a selectable textarea, so this is a convenience, never the only route.
      setCopied(false);
    }
  }

  return (
    <div
      data-testid="deleted-note-banner"
      role="alertdialog"
      aria-label="This note was deleted"
      className={styles.banner}
    >
      <div className={styles.text}>
        <strong>“{rescue.title || 'Untitled note'}” was deleted, so your last change couldn’t be
        saved.</strong>{' '}
        Here is the text it was carrying — copy anything you need before you close this tab.
        <textarea
          data-testid="deleted-note-text"
          aria-label="Text from the deleted note"
          className={styles.rescued}
          readOnly
          value={rescue.text}
        />
      </div>
      <div className={styles.actions}>
        <button
          type="button"
          data-testid="copy-deleted-note-text"
          className={styles.action}
          onClick={() => void handleCopy(rescue.text)}
        >
          {copied ? 'Copied' : 'Copy text'}
        </button>
        <button
          type="button"
          data-testid="dismiss-deleted-note"
          className={styles.action}
          onClick={() => clearDeletedNote()}
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
