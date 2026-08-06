import { useEffect } from "react";

export const APP_TITLE = "Note Taker AI";

// CHANGE-36: the browser tab title follows the note you have open, so several notes open in
// several browser tabs are tellable apart from the tab strip alone (Phase 49 made that a normal
// way to work). Pass null — or an untitled note — to sit on the plain app title.
//
// The document title is global, so this restores APP_TITLE on unmount rather than leaving the
// last note's name on a tab that has navigated back to the list.
export function useDocumentTitle(noteTitle: string | null | undefined) {
  const trimmed = noteTitle?.trim();
  useEffect(() => {
    document.title = trimmed ? `${trimmed} - ${APP_TITLE}` : APP_TITLE;
    return () => {
      document.title = APP_TITLE;
    };
  }, [trimmed]);
}
