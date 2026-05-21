# Learnings — Slice 11-F: Adaptive note action buttons

## Mutual exclusion via conditional slot renders cleanly

Putting Save and Cancel in the same DOM slot (`{!hasContent ? <Cancel> : <Save>}`) makes the mutual exclusion structurally obvious and impossible to violate. Avoid parallel booleans that control two overlapping sections separately — they drift. One slot, one condition.

## Test every arm of a new predicate in isolation

`hasContent` has five arms: title, content, tags, actionCount, transcriptText. Tests covered the first four through their respective transitions. The `transcriptText !== null` arm was untested until Hawk flagged it — a note that has only a transcript (from a recording with no typing) would flash Cancel during the load window and then flip to Save+Delete, but no test verified that flip.

**Rule:** for every boolean predicate introduced, at least one test should isolate each arm as the *sole* truthy trigger. This is especially important for arms loaded asynchronously (transcriptText comes from the API, not from user interaction).

## Phase doc and cross-slice annotations belong in the same commit as the implementation

11-H's acceptance criteria described a discard-dialog flow that 11-F removed. This wasn't flagged during implementation — it was caught by Hawk. Updating the phase doc status and annotating superseded criteria from other slices should be part of the implementation commit, not a separate "fix" after review.

## Removing confirmation dialogs requires explicit UX justification in the doc

The discard dialog on non-blank notes was removed with no replacement. This is a deliberate UX decision (the spec says "the action is immediately reversible by recreating the note") that should be documented in the phase doc, not left implicit. Future readers seeing Delete with no confirmation need to know this was intentional, not an accidental omission.

## `disabled={loadingDetail}` guard on Save is still correct without `isSaveEnabled`

The old Save button used `disabled={!isSaveEnabled || loadingDetail}`. With `hasContent` replacing `isSaveEnabled` and Save only appearing when `hasContent` is true, the `!isSaveEnabled` guard is redundant — but `disabled={loadingDetail}` should stay. An existing note with a title shows Save immediately (before API load completes), and we don't want the user saving an empty content area before the API has filled it in. Verify: `findByLabelText('Note content')` resolves only after `loadingDetail = false` (NoteEditor is inside a `!loadingDetail` branch), so any test that clicks Save will naturally wait for loading to complete.
