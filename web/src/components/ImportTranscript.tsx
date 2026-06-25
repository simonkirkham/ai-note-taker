import { useCallback, useRef, useState } from "react";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { useImportTranscript } from "../hooks/useNoteMutations";
import styles from "./ImportTranscript.module.css";

// Phase 38: paste a transcript captured in an external tool to create an analysed note. The trigger
// button opens a modal (mounted only while open, so the focus trap activates); on submit the server
// creates + analyses the note in one call and the caller navigates to it.
export default function ImportTranscript({
  onImported,
}: {
  onImported: (noteId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="new-note-button"
        data-testid="import-transcript-button"
        onClick={() => setOpen(true)}
      >
        Import Transcript
      </button>
      {open && (
        <ImportTranscriptModal
          onClose={() => setOpen(false)}
          onImported={(noteId) => {
            setOpen(false);
            onImported(noteId);
          }}
        />
      )}
    </>
  );
}

// Optimistic feedback: the submit button flips to "Importing…" immediately; on error the modal stays
// open with the pasted text preserved (never cleared) and shows an inline error.
function ImportTranscriptModal({
  onClose,
  onImported,
}: {
  onClose: () => void;
  onImported: (noteId: string) => void;
}) {
  const [text, setText] = useState("");
  const dialogRef = useRef<HTMLDivElement>(null);
  const importM = useImportTranscript();
  const isPending = importM.isPending;
  // Block close (Escape/backdrop) mid-import so a stray key can't abandon the in-flight request.
  // Stable identity (useCallback) so the focus trap's effect does not re-run — and steal focus back
  // to the close button — on every keystroke (which would let a typed space activate it).
  const requestClose = useCallback(() => {
    if (!isPending) onClose();
  }, [isPending, onClose]);
  useFocusTrap(dialogRef, { onClose: requestClose });

  async function submit() {
    if (!text.trim() || importM.isPending) return;
    try {
      const { noteId } = await importM.mutateAsync({ transcriptText: text });
      onImported(noteId);
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
      aria-label="Import transcript"
      onClick={(e) => {
        if (e.target === e.currentTarget) requestClose();
      }}
    >
      <div ref={dialogRef} className={styles.dialog} data-testid="import-transcript-dialog">
        <header className={styles.header}>
          <h2 className={styles.title}>Import transcript</h2>
          <button
            type="button"
            aria-label="Close"
            className={styles.closeBtn}
            onClick={requestClose}
            disabled={importM.isPending}
          >
            ✕
          </button>
        </header>
        <p className={styles.hint}>
          Paste a transcript from another tool. It runs through the same analysis as a recording —
          summary, action items, and tags.
        </p>
        <textarea
          className={styles.textarea}
          data-testid="import-transcript-textarea"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Paste transcript text here…"
          rows={12}
          disabled={importM.isPending}
        />
        {importM.isError && (
          <p className={styles.error} role="alert" data-testid="import-transcript-error">
            Couldn’t import the transcript. Please try again.
          </p>
        )}
        <div className={styles.actions}>
          <button type="button" className={styles.cancelBtn} onClick={requestClose} disabled={importM.isPending}>
            Cancel
          </button>
          <button
            type="button"
            className={styles.submitBtn}
            data-testid="import-transcript-submit"
            onClick={() => void submit()}
            disabled={!text.trim() || importM.isPending}
          >
            {importM.isPending ? "Importing…" : "Import & analyse"}
          </button>
        </div>
      </div>
    </div>
  );
}
