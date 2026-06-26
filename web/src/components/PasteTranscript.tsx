import { useCallback, useRef, useState } from "react";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { useImportTranscriptIntoNote } from "../hooks/useNoteMutations";
import styles from "./PasteTranscript.module.css";

// Phase 38-B: paste a transcript captured in an external tool INTO the open note — it runs the same
// analysis as a recording. The trigger sits next to Record on the Transcript tab; the modal is
// mounted only while open so the focus trap activates. If the note already has a transcript, the
// modal warns and the primary button reads "Replace & analyse" (the deliberate replace-confirm).
export default function PasteTranscript({
  noteId,
  hasTranscript,
  onImported,
}: {
  noteId: string;
  hasTranscript: boolean;
  onImported: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className={styles.trigger}
        data-testid="paste-transcript-button"
        onClick={() => setOpen(true)}
      >
        Paste transcript
      </button>
      {open && (
        <PasteTranscriptModal
          noteId={noteId}
          hasTranscript={hasTranscript}
          onClose={() => setOpen(false)}
          onImported={() => {
            setOpen(false);
            onImported();
          }}
        />
      )}
    </>
  );
}

// Optimistic feedback: the submit button flips to "Importing…" immediately; on error the modal stays
// open with the pasted text preserved (never cleared) and shows an inline error.
function PasteTranscriptModal({
  noteId,
  hasTranscript,
  onClose,
  onImported,
}: {
  noteId: string;
  hasTranscript: boolean;
  onClose: () => void;
  onImported: () => void;
}) {
  const [text, setText] = useState("");
  const dialogRef = useRef<HTMLDivElement>(null);
  const importM = useImportTranscriptIntoNote(noteId);
  const isPending = importM.isPending;
  // Block close (Escape/backdrop) mid-import so a stray key can't abandon the in-flight request.
  // Stable identity (useCallback) so the focus trap's effect does not re-run — and steal focus back
  // to the close button — on every keystroke (which would let a typed space activate it).
  const requestClose = useCallback(() => {
    if (!isPending) onClose();
  }, [isPending, onClose]);
  useFocusTrap(dialogRef, { onClose: requestClose });

  async function submit() {
    if (!text.trim() || isPending) return;
    try {
      await importM.mutateAsync({ transcriptText: text });
      onImported();
    } catch {
      // Error surfaced inline below; the modal stays open with the pasted text preserved.
    }
  }

  return (
    /* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/click-events-have-key-events */
    <div
      className={styles.overlay}
      role="dialog"
      aria-modal="true"
      aria-label="Paste transcript"
      onClick={(e) => {
        if (e.target === e.currentTarget) requestClose();
      }}
    >
      <div ref={dialogRef} className={styles.dialog} data-testid="paste-transcript-dialog">
        <header className={styles.header}>
          <h2 className={styles.title}>Paste transcript</h2>
          <button
            type="button"
            aria-label="Close"
            className={styles.closeBtn}
            onClick={requestClose}
            disabled={isPending}
          >
            ✕
          </button>
        </header>
        <p className={styles.hint}>
          Paste a transcript from another tool. It runs through the same analysis as a recording —
          summary, action items, and tags.
        </p>
        {hasTranscript && (
          <p className={styles.warning} role="alert" data-testid="paste-transcript-replace-warning">
            This note already has a transcript — importing will replace it.
          </p>
        )}
        <textarea
          className={styles.textarea}
          data-testid="paste-transcript-textarea"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Paste transcript text here…"
          rows={12}
          maxLength={350000}
          disabled={isPending}
        />
        {importM.isError && (
          <p className={styles.error} role="alert" data-testid="paste-transcript-error">
            Couldn’t import the transcript. Please try again.
          </p>
        )}
        <div className={styles.actions}>
          <button type="button" className={styles.cancelBtn} onClick={requestClose} disabled={isPending}>
            Cancel
          </button>
          <button
            type="button"
            className={styles.submitBtn}
            data-testid="paste-transcript-submit"
            onClick={() => void submit()}
            disabled={!text.trim() || isPending}
          >
            {isPending ? "Importing…" : hasTranscript ? "Replace & analyse" : "Import & analyse"}
          </button>
        </div>
      </div>
    </div>
  );
}
