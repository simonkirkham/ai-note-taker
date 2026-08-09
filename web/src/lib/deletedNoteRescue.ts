import { useSyncExternalStore } from 'react';

// BUG-59: when a save 404s because the note was deleted, the text the user typed exists ONLY in
// the browser. Attempt 1 held it in NoteView's own state, which loses it twice over:
//
//   1. The commonest exit is "Back to notes", which fires the save and navigates in the same tick.
//      The 404 lands after NoteView has unmounted, so a setState there is a no-op and the user
//      walks away with no message at all — silently worse than the misleading retry toast it
//      replaced.
//   2. Any `keys.note` invalidation (useAnalyseNote.onSettled, refreshNote, useTagMutations)
//      re-renders the note as not-found and bounces home, taking the banner and the text with it.
//
// So the rescued text lives OUTSIDE React's tree, in module state, and is rendered by App above
// the router. Unmounting the note — which is now the correct thing to do, since the note really is
// gone — no longer destroys it. It is deliberately not in the query cache either: everything in
// there is invalidatable by design, and this must not be.
//
// One slot, not a queue: two notes cannot be open in the same tab, and a second deletion replacing
// the first would be a worse failure than showing them one at a time.

export type DeletedNoteRescue = {
  noteId: string;
  title: string;
  text: string;
};

let current: DeletedNoteRescue | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function reportDeletedNote(rescue: DeletedNoteRescue): void {
  current = rescue;
  emit();
}

export function clearDeletedNote(): void {
  if (current === null) return;
  current = null;
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function snapshot(): DeletedNoteRescue | null {
  return current;
}

export function useDeletedNoteRescue(): DeletedNoteRescue | null {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

// Module state outlives a test, exactly as it outlives a component — reset it between tests the
// same way the workspace and open-tab stores are reset in `src/test/setup.ts`. Deliberately does
// NOT clear `listeners`: a component still mounted when this runs owns its own unsubscribe, and
// dropping it here would leave it permanently deaf instead of merely stale.
export function resetDeletedNoteRescueForTests(): void {
  clearDeletedNote();
}
