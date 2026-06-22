import { useCallback, useEffect, useRef } from 'react';

// Intercept browser Back/Forward (popstate, e.g. Alt+←) while `when` is true, so a
// leave can be confirmed instead of silently unmounting the view. BrowserRouter has
// no `useBlocker` (that needs a data router), so we guard popstate directly.
//
// BUG-34: a recording lost its in-progress transcript because Alt+← aborted the
// unmount-commit; routing Back through the leave-confirm keeps the capture safe.
//
// Mechanism: while armed, keep exactly one extra "sentinel" history entry on top of
// the view's own entry. A Back press then pops the sentinel (firing popstate) instead
// of leaving the view; the handler re-pushes the sentinel to hold position and calls
// onAttempt (which shows the confirm dialog). The sentinel is always reconciled away
// when the guard disarms — on a plain disarm (e.g. recording stopped) the cleanup
// pops it so the user's next Back is not silently swallowed; on a deliberate leave
// `confirmLeave` pops it itself and then runs the real navigation.
export function usePopstateGuard(
  when: boolean,
  onAttempt: () => void,
): { confirmLeave: (proceed: () => void) => void } {
  // Keep the latest callback in a ref so re-arming on each popstate never needs to
  // tear down and re-add the listener when only the callback identity changes.
  const onAttemptRef = useRef(onAttempt);
  useEffect(() => {
    onAttemptRef.current = onAttempt;
  }, [onAttempt]);

  // True only while we are deliberately leaving — suppresses the cleanup-pop so the
  // sentinel is removed exactly once (by confirmLeave), never double-popped.
  const leavingRef = useRef(false);
  // Tracks whether our sentinel is currently on the history stack, so cleanup pops it
  // iff we actually pushed one (and confirmLeave didn't already remove it).
  const sentinelRef = useRef(false);

  useEffect(() => {
    if (!when) return;
    leavingRef.current = false;
    // Push the sentinel so the next Back press pops THIS entry (firing popstate)
    // rather than navigating away from the view.
    window.history.pushState(window.history.state, '');
    sentinelRef.current = true;
    const handler = () => {
      // A deliberate leave (confirmLeave) pops the sentinel itself — let that through.
      if (leavingRef.current) return;
      // The Back press just popped our sentinel. Re-push it to hold position, then
      // surface the leave attempt to the caller (which shows the confirm dialog).
      window.history.pushState(window.history.state, '');
      sentinelRef.current = true;
      onAttemptRef.current();
    };
    window.addEventListener('popstate', handler);
    return () => {
      window.removeEventListener('popstate', handler);
      // Disarm without leaving (e.g. Stop pressed): remove the leftover sentinel so
      // the user's next Back isn't consumed silently. confirmLeave sets leavingRef
      // and pops it itself, so skip in that case.
      if (!leavingRef.current && sentinelRef.current) {
        sentinelRef.current = false;
        window.history.back();
      }
    };
  }, [when]);

  // Leave for real: disarm so the handler ignores the pop, remove the sentinel, then
  // run the caller's navigation. `proceed` runs after the sentinel pop has settled so
  // a relative navigate(-1) targets the entry behind the view, not the sentinel. A
  // timeout fallback runs proceed even if popstate never fires, so a leave can never
  // deadlock waiting on the event.
  const confirmLeave = useCallback((proceed: () => void) => {
    leavingRef.current = true;
    if (!sentinelRef.current) {
      // No sentinel to pop (already gone) — navigate directly.
      proceed();
      return;
    }
    sentinelRef.current = false;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      window.removeEventListener('popstate', onPopped);
      clearTimeout(fallback);
      proceed();
    };
    const onPopped = () => finish();
    const fallback = setTimeout(finish, 100);
    window.addEventListener('popstate', onPopped);
    window.history.back();
  }, []);

  return { confirmLeave };
}
