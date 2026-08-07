import { useCallback, useEffect, useState } from "react";
import { recordRumEvent } from "../rum";

export type OpenNoteTab = { noteId: string; title: string };

const NO_TABS: OpenNoteTab[] = [];

// 49-B: per-device, per-workspace persistence. Same shape as the other client-only
// preferences (`useTheme`, `useKeepAudioLocal`) — every access is try/caught, and a browser
// that refuses storage (private mode, quota) degrades to session-only rather than throwing.
const STORAGE_PREFIX = "note-taker-open-tabs-";

const storageKey = (wsId: string) => `${STORAGE_PREFIX}${wsId}`;

// Anything unreadable — absent, corrupt JSON, or the wrong shape (a hand-edited value, or a
// future version's format) — reads as "no tabs" rather than breaking the app.
//
// Deliberately NOT capped. A cap was tried and removed on review: restore capped while writes
// did not, so 60 open tabs became 50 on reload and the persist effect then wrote the truncated
// list straight back — silent, permanent loss. It also contradicted 49-A's explicit "no tab
// cap" decision. The only thing a cap defended against was a hand-edited value rendering many
// buttons, which is self-inflicted, bounded by the cards reconcile, and not worth losing a
// user's tabs over. The dedupe stays: duplicate ids are a real correctness bug (duplicate
// React keys, two tabs both marked current), not merely untidy.
function readStoredTabs(wsId: string): OpenNoteTab[] {
  let raw: string | null;
  try {
    raw = localStorage.getItem(storageKey(wsId));
  } catch {
    // Storage refused outright (private mode, quota) — the user's tabs are simply not
    // remembered on this device, which is invisible from the outside without this signal.
    recordRumEvent("tabRestoreFailed", { reason: "storageUnavailable" });
    return NO_TABS;
  }
  if (!raw) return NO_TABS;
  try {
    const parsed: unknown = JSON.parse(raw);
    const list = (parsed as { tabs?: unknown })?.tabs;
    if (!Array.isArray(list)) {
      recordRumEvent("tabRestoreFailed", { reason: "wrongShape" });
      return NO_TABS;
    }
    const byNoteId = new Map<string, OpenNoteTab>();
    for (const entry of list) {
      const noteId = (entry as { noteId?: unknown })?.noteId;
      if (typeof noteId !== "string" || !noteId || byNoteId.has(noteId)) continue;
      const title = (entry as { title?: unknown })?.title;
      byNoteId.set(noteId, { noteId, title: typeof title === "string" ? title : "" });
    }
    return byNoteId.size > 0 ? [...byNoteId.values()] : NO_TABS;
  } catch {
    recordRumEvent("tabRestoreFailed", { reason: "corrupt" });
    return NO_TABS;
  }
}

function writeStoredTabs(wsId: string, tabs: OpenNoteTab[]): void {
  try {
    const key = storageKey(wsId);
    // Nothing open and nothing remembered — writing `{"tabs":[]}` here would leave an empty
    // key behind for every workspace the user merely visits. Closing the last tab still
    // writes (the key exists by then), so "cleared" is still remembered as cleared.
    if (tabs.length === 0 && localStorage.getItem(key) === null) return;
    localStorage.setItem(key, JSON.stringify({ tabs }));
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
