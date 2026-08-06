import { useEffect } from "react";

export const APP_TITLE = "Note Taker AI";

// CHANGE-36: the browser tab title follows the note you have open, so several notes open in
// several browser tabs are tellable apart from the tab strip alone (Phase 49 made that a normal
// way to work). Pass null — or an untitled note — to sit on the plain app title.
//
// The document title is global, so this restores APP_TITLE on unmount rather than leaving the
// last note's name on a tab that has navigated back to the list. Restoring the CONSTANT (rather
// than whatever was there on mount) is safe only because this hook is the sole writer of
// document.title in the app — a second consumer wanting its own title would need this to
// capture and restore the previous value instead.
//
// Switching notes is safe: React flushes every effect CLEANUP for a commit before any effect
// SETUP, so the outgoing note's reset always lands before the incoming note's write, in the
// same flush with no paint between — no stale title, no flicker.
export function useDocumentTitle(noteTitle: string | null | undefined) {
  const trimmed = noteTitle?.trim();
  useEffect(() => {
    document.title = trimmed ? `${trimmed} - ${APP_TITLE}` : APP_TITLE;
    return () => {
      document.title = APP_TITLE;
    };
  }, [trimmed]);
}
