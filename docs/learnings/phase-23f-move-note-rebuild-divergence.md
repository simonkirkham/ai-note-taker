# 23-F — moving a note: live re-bucket must match a rebuild

**Slice:** 23-F (move a note to another workspace).

## The non-obvious bug

A `MoveNoteToWorkspace` re-emits `NoteAssignedToWorkspace` for an existing note. Six note-derived read models must re-bucket to the target workspace. Five do so trivially; **two key child rows independently of `NoteId`** and need explicit re-stamping:

| Projection | Keyed by | Re-buckets on move? |
|---|---|---|
| NoteCard / NoteDetail / NoteTitle / NoteSearch | `NoteId` | Yes — single row updated in place |
| **TodoList** | action-item id | Needs all the note's rows re-stamped |
| **TagIndex** | `(Tag, NoteId)` | Needs all the note's rows re-stamped |

The live command path (`NoteCommandHandler`) was handled by adding `RebucketWorkspaceForMoveAsync` (re-stamp todo rows via a new `UpdateNoteWorkspaceAsync`; re-`PutAsync` each tag row).

## What the convergence test caught

`TagIndexProjection` (the **rebuild** path) updated its `_workspaceByNote` map on `NoteAssignedToWorkspace` but **did not re-stamp tag rows already emitted** — unlike `TodoListProjection`, which back-fills. So after a move, a full rebuild left the moved note's tags in the *old* workspace while the live path moved them to the new one. **Live and rebuild diverged.**

Code review missed this by inspection (it assumed `PutAsync` overwrite made them converge — true for the live path, but the *rebuild* projection never re-stamped). The integration test that replays the event stream through `/admin/projections/rebuild` and asserts the result is byte-identical to the live result is what surfaced it.

## Takeaways

1. **For any move/reassignment slice, add a live==rebuild convergence test** — replay through the rebuild and assert equality. Inspection is not enough; the two code paths drift independently.
2. **When you re-stamp a derived row on the live path, check the matching projection's rebuild arm re-stamps too.** The fix mirrors `TodoListProjection`'s back-fill loop in `TagIndexProjection`.
3. **A rebuild test must join `[Collection("ProjectionRebuild")]`** — the rebuild single-flight lock is process-wide; parallel rebuilds 409-collide.
4. Only `TagIndex` + `TodoList` have this shape; the four `NoteId`-keyed projections cannot diverge. See [[phase-23g-rootless-route-removal]] for the rest of the workspace cleanup.
