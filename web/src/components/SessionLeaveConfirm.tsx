import styles from "./SessionLeaveConfirm.module.css";

// 51-C review follow-up — the confirm raised when a leave would destroy a capture that is
// running in a note you are NOT looking at.
//
// The semantics here are load-bearing and are the same set NoteView's in-header copy carries
// (CHANGE-33): the accessible NAME carries the destination, and the live region sits on the
// dialog itself rather than on the text inside it. A second guarded click replaces the
// destination while the dialog is already open and nothing focuses it, so without an explicit
// live region the swap is announced to nobody; a nested region (alertdialog already inherits
// alert's implicit live semantics) is read twice or dropped depending on the screen reader.
// `aria-atomic` so the whole phrase is re-read rather than the changed words alone.
export default function SessionLeaveConfirm({
  destination,
  finishing,
  finishingDestination,
  onConfirm,
  onCancel,
}: {
  /** Where the user asked to go, in the CHANGE-33 phrasing ("sign out", "close this tab"). */
  destination: string | null;
  /** The leave is confirmed and parked on the transcript commit (BUG-55). */
  finishing: boolean;
  /**
   * The destination being waited on, in the same phrasing. Separate from `destination`, which
   * is cleared the moment the leave is confirmed — so by the time this banner shows, the thing
   * the user asked for is no longer on the other prop.
   */
  finishingDestination?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  // Deliberately ahead of the destination branch, mirroring NoteView: once the leave is
  // decided, a further guarded request is swallowed rather than raising a second confirm.
  if (finishing) {
    return (
      <span
        className={styles.banner}
        role="status"
        aria-live="polite"
        data-testid="finishing-transcript"
      >
        <span className={styles.text}>
          {/* Correct only by coincidence when hardcoded: `finishing` is driven by the
              wait-for-the-save flag, which today only sign-out passes. Say what the caller
              actually asked for, so it stays true the first time another destination waits. */}
          Finishing the transcript — we&rsquo;ll {finishingDestination ?? "sign out"} once
          it&rsquo;s saved&hellip;
        </span>
      </span>
    );
  }

  if (destination === null) return null;

  return (
    <span
      className={styles.banner}
      role="alertdialog"
      aria-label={`Recording in progress — ${destination}?`}
      aria-live="assertive"
      aria-atomic="true"
    >
      <span className={styles.text} data-testid="leave-confirm-text">
        Still recording — {destination}?
      </span>
      <button data-testid="confirm-leave-button" onClick={onConfirm} className={styles.confirm}>
        Leave &amp; save
      </button>
      <button data-testid="cancel-leave-button" onClick={onCancel} className={styles.cancel}>
        Keep recording
      </button>
    </span>
  );
}
