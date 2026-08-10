import { useState } from 'react';
import {
  dismissDeletedNote,
  useDeletedNoteRescues,
  type DeletedNoteRescue as Rescue,
} from '../lib/deletedNoteRescue';
import styles from './DeletedNoteRescue.module.css';
import { useToast } from './toastContext';

// BUG-59: rendered by App above the router, NOT inside NoteView. Attempt 1 put it in the note's
// quick-notes tabpanel, which is `hidden` from the Transcript and Final tabs — so the one banner
// telling the user their text was rescued was invisible from the tab whose own button (Generate
// final notes) triggers a save. Here it is outside every tabpanel and outside the route, so it
// survives the navigation home that a deleted note now causes.
//
// `role="alert"`, not the `alertdialog` the stale-conflict banner uses: nothing moves focus here,
// there is no focus trap and no `aria-modal`, and a dialog role is not a live region — so a screen
// reader would announce nothing at all. This banner arrives unbidden AFTER the user has been
// navigated home, and it is the only route to their unsaved text, so it must announce itself.
//
// The role sits on the MESSAGE, not the wrapper: a live region containing the textarea would read
// the entire rescued note body aloud on arrival.
function RescueBanner({ rescue }: { rescue: Rescue }) {
  const [copied, setCopied] = useState(false);
  const { showError } = useToast();

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(rescue.text);
      setCopied(true);
    } catch {
      // Clipboard denied or unavailable (no secure context, permission refused). Say so — a button
      // that silently does nothing invites the user to close the tab believing the copy landed,
      // which is precisely the loss this banner exists to prevent. The textarea below is still
      // selectable, so there is a route left.
      setCopied(false);
      showError('Couldn’t copy automatically — select the text below and copy it manually.');
    }
  }

  return (
    <div data-testid="deleted-note-banner" className={styles.banner}>
      <div className={styles.text}>
        <span role="alert">
          <strong>
            “{rescue.title || 'Untitled note'}” was deleted, so your last change couldn’t be saved.
          </strong>{' '}
          Here is the text it was carrying — copy anything you need before you close this tab.
        </span>
        <textarea
          data-testid="deleted-note-text"
          aria-label={`Text from the deleted note ${rescue.title || 'Untitled note'}`}
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
          onClick={() => void handleCopy()}
        >
          {copied ? 'Copied' : 'Copy text'}
        </button>
        <button
          type="button"
          data-testid="dismiss-deleted-note"
          className={styles.action}
          onClick={() => dismissDeletedNote(rescue.noteId)}
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}

export default function DeletedNoteRescue() {
  const rescues = useDeletedNoteRescues();
  // Keyed by noteId so each banner owns its own "Copied" label. Holding that state in a single
  // always-mounted component made it STICKY: copy for note A, dismiss, then have note B deleted, and
  // B's button read "Copied" for text that was never on the clipboard.
  return rescues.map((rescue) => <RescueBanner key={rescue.noteId} rescue={rescue} />);
}
