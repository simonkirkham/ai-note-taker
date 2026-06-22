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
// onAttempt (which shows the confirm dialog). To actually leave, the caller invokes
// the returned `confirmLeave(proceed)`: it disarms the guard, pops the sentinel, and
// runs `proceed` (the real navigation) once the pop has settled — so the back/leave
// lands on the previous screen, not back on the sentinel.
export function usePopstateGuard(when: boolean, onAttempt: () => void): { confirmLeave: (proceed: () => void) => void } {
  // Keep the latest callback in a ref so re-arming on each popstate never needs to
  // tear down and re-add the listener when only the callback identity changes.
  const onAttemptRef = useRef(onAttempt);
  useEffect(() => {
    onAttemptRef.current = onAttempt;
  }, [onAttempt]);

  // True only while we are deliberately leaving — lets the sentinel-pop through.
  const leavingRef = useRef(false);

  useEffect(() => {
    if (!when) return;
    leavingRef.current = false;
    // Push the sentinel so the next Back press pops THIS entry (firing popstate)
    // rather than navigating away from the view.
    window.history.pushState(window.history.state, '');
    const handler = () => {
      if (leavingRef.current) return;
      // Re-push the sentinel to keep the user on the current view, then surface the
      // leave attempt to the caller (which shows the confirm dialog).
      window.history.pushState(window.history.state, '');
      onAttemptRef.current();
    };
    window.addEventListener('popstate', handler);
    return () => window.removeEventListener('popstate', handler);
  }, [when]);

  // Leave for real: disarm so the handler ignores the pop, remove the sentinel, then
  // run the caller's navigation. `proceed` runs after the sentinel pop has settled so
  // a relative navigate(-1) targets the entry behind the view, not the sentinel.
  const confirmLeave = useCallback((proceed: () => void) => {
    leavingRef.current = true;
    const onPopped = () => {
      window.removeEventListener('popstate', onPopped);
      proceed();
    };
    window.addEventListener('popstate', onPopped);
    window.history.back();
  }, []);

  return { confirmLeave };
}
