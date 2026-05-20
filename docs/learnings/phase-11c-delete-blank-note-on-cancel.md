# Phase 11-C Learnings — Delete blank note on cancel

## What was built

Clicking Cancel on a freshly-created note now calls `onDelete(noteId)` instead of `onBack()`, so ghost blank entries are never left in the list. Cancelling an existing note is unaffected. A single `isNew?: boolean` prop on `NoteView` carries the distinction; the flag lives on the `View` discriminated union in `App.tsx` and is set only in `handleNewNote`.

---

## Done

### Await async props in event handlers

**Observation:** `handleCancel` called `onDelete(noteId)` fire-and-forget — the returned `Promise<void>` was silently dropped. The same pattern appeared on the confirm-button `onClick`. Hawk caught both in the first review pass.

**Rule:** Any React event handler that invokes an `async` prop must `await` it. Mark the handler `async` and add `await`; for inline JSX handlers, use `async () => { await fn(); }`.

**Why it matters:** A dropped Promise swallows network errors silently. In this case a failed delete would leave the note absent from local state but still in DynamoDB, with no user feedback.

**Pre-PR check to add:** Before opening a PR, scan every new or modified event handler for props typed as `Promise<*>` and verify they are awaited.

---

### Cover the "else branch" of a conditional prop explicitly in tests

**Observation:** The `isNew` prop routes Cancel to either `onDelete` (new note) or `onBack` (existing note). Tests covered the `isNew: true` side but the `isNew: false` (omitted) side was only incidentally covered by an older test with no assertion that `onDelete` was *not* called. Hawk flagged this as an unguarded regression risk.

**Rule:** When a new prop controls a branch, write at least one test per branch. For the else-branch, assert that the *other* side-effect does *not* fire (`expect(fn).not.toHaveBeenCalled()`), not just that the expected path ran.

---

### Run `git diff --cached` before every commit to catch stray staged files

**Observation:** A pre-staged `NoteTakerStack.cs` change (unrelated in-progress work) slipped into the Hawk-fixes commit because the staging `git add` path list was constructed correctly but the file had been partially staged before the session began. The commit had to be reset and redone.

**Rule:** Before `git commit`, run `git diff --cached --name-only` and verify the file list matches exactly what the commit message describes. If unrelated files appear, unstage them before committing.

---

## Token spike note

Two Hawk passes (~75k tokens total) dominated this slice. Both would have been avoided by the pre-PR checklist item above (await async props). See `docs/token-log.md` for the full breakdown.
