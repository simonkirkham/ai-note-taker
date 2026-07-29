import { useCallback, useEffect, useState } from "react";

export type OpenNoteTab = { noteId: string; title: string };

const NO_TABS: OpenNoteTab[] = [];

// 49-B: per-device, per-workspace persistence. Same shape as the other client-only
// preferences (`useTheme`, `useKeepAudioLocal`) — every access is try/caught, and a browser
// that refuses storage (private mode, quota) degrades to session-only rather than throwing.
const STORAGE_PREFIX = "note-taker-open-tabs-";

const storageKey = (wsId: string) => `${STORAGE_PREFIX}${wsId}`;

// Anything unreadable — absent, corrupt JSON, or the wrong shape (a hand-edited value, or a
// future version's format) — reads as "no tabs" rather than breaking the app.
export function readStoredTabs(wsId: string): OpenNoteTab[] {
  try {
    const raw = localStorage.getItem(storageKey(wsId));
    if (!raw) return NO_TABS;
    const parsed: unknown = JSON.parse(raw);
    const list = (parsed as { tabs?: unknown })?.tabs;
    if (!Array.isArray(list)) return NO_TABS;
    const clean = list
      .filter((t): t is { noteId: string; title?: unknown } =>
        typeof (t as { noteId?: unknown })?.noteId === "string" && !!(t as { noteId: string }).noteId,
      )
      .map((t) => ({ noteId: t.noteId, title: typeof t.title === "string" ? t.title : "" }));
    return clean.length > 0 ? clean : NO_TABS;
  } catch {
    return NO_TABS;
  }
}

function writeStoredTabs(wsId: string, tabs: OpenNoteTab[]): void {
  try {
    localStorage.setItem(storageKey(wsId), JSON.stringify({ tabs }));
  } catch {
    /* storage unavailable — this device just won't remember the set */
  }
}

// 49-A: the set of notes the user has open. Client-side only — no event, no projection,
// no endpoint. A tab is an id plus the title captured when it was opened; the live title is
// resolved from the note-cards list at render, so a rename re-derives for free.
//
// Only the ACTIVE tab's NoteView is mounted (switching a tab is the existing route
// navigation), so an inactive tab costs a string, not a mount.
//
// Keyed by workspace rather than held as one slot for the current workspace: a note opened
// in A must never surface in B, and a close in B must not discard what A had open. 49-B
// persists this same shape per workspace.
export function useOpenNoteTabs(wsId: string) {
  const [byWorkspace, setByWorkspace] = useState<Record<string, OpenNoteTab[]>>(() => ({
    [wsId]: readStoredTabs(wsId),
  }));
  // Switching workspace loads that workspace's own remembered set the first time it is
  // seen. Adjusted during render (React's pattern for "reset state when an input changes")
  // — an effect would paint one frame of the wrong workspace's tabs first, and a setState
  // in an effect body is a lint gate here.
  const [prevWsId, setPrevWsId] = useState(wsId);
  if (prevWsId !== wsId) {
    setPrevWsId(wsId);
    setByWorkspace((prev) => (prev[wsId] ? prev : { ...prev, [wsId]: readStoredTabs(wsId) }));
  }
  const tabs = byWorkspace[wsId] ?? NO_TABS;

  // Persist after commit, never inside a state updater (which React may call twice).
  useEffect(() => {
    writeStoredTabs(wsId, tabs);
  }, [wsId, tabs]);

  const openTab = useCallback(
    (noteId: string, title?: string) =>
      setByWorkspace((prev) => {
        const base = prev[wsId] ?? NO_TABS;
        const existing = base.find((t) => t.noteId === noteId);
        if (!existing) return { ...prev, [wsId]: [...base, { noteId, title: title ?? "" }] };
        // Already open — focusing it is the caller's job (the route). Only refresh a title
        // the caller knows better than the stored one (a note created with a meeting title).
        if (!title || title === existing.title) return prev;
        return { ...prev, [wsId]: base.map((t) => (t.noteId === noteId ? { ...t, title } : t)) };
      }),
    [wsId],
  );

  const closeTab = useCallback(
    (noteId: string) =>
      setByWorkspace((prev) => {
        const base = prev[wsId];
        if (!base?.some((t) => t.noteId === noteId)) return prev;
        return { ...prev, [wsId]: base.filter((t) => t.noteId !== noteId) };
      }),
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
