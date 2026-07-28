import { useCallback, useState } from "react";

export type OpenNoteTab = { noteId: string; title: string };

type State = { wsId: string; tabs: OpenNoteTab[] };

// 49-A: the set of notes the user has open. Client-side only — no event, no projection,
// no endpoint. A tab is an id plus the title captured when it was opened; the live title is
// resolved from the note-cards list at render, so a rename re-derives for free.
//
// Only the ACTIVE tab's NoteView is mounted (switching a tab is the existing route
// navigation), so an inactive tab costs a string, not a mount.
//
// Tabs belong to the workspace they were opened in: the state carries its own wsId and
// reads as empty under any other one, so switching workspace can never show a foreign note.
export function useOpenNoteTabs(wsId: string) {
  const [state, setState] = useState<State>({ wsId, tabs: [] });
  const tabs = state.wsId === wsId ? state.tabs : [];

  const openTab = useCallback(
    (noteId: string, title?: string) =>
      setState((prev) => {
        const base = prev.wsId === wsId ? prev.tabs : [];
        const existing = base.find((t) => t.noteId === noteId);
        if (!existing) return { wsId, tabs: [...base, { noteId, title: title ?? "" }] };
        // Already open — focusing it is the caller's job (the route). Only refresh a title
        // the caller knows better than the stored one (a note created with a meeting title).
        if (!title || title === existing.title) return { wsId, tabs: base };
        return { wsId, tabs: base.map((t) => (t.noteId === noteId ? { ...t, title } : t)) };
      }),
    [wsId],
  );

  const closeTab = useCallback(
    (noteId: string) =>
      setState((prev) => ({
        wsId,
        tabs: (prev.wsId === wsId ? prev.tabs : []).filter((t) => t.noteId !== noteId),
      })),
    [wsId],
  );

  return { tabs, openTab, closeTab };
}

// Which tab to land on when the active one closes: the next along, else the previous, else
// nothing (the caller returns to the notes list).
export function neighbourOf(tabs: OpenNoteTab[], closedNoteId: string): string | undefined {
  const index = tabs.findIndex((t) => t.noteId === closedNoteId);
  if (index < 0) return undefined;
  const remaining = tabs.filter((t) => t.noteId !== closedNoteId);
  return (remaining[index] ?? remaining[index - 1])?.noteId;
}
