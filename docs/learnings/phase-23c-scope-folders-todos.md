# Phase 23-C — Scope folders + to-dos; block delete of non-empty workspace

**Shipped:** PR #218. Folders, the to-do list, and tag filters become per-workspace; a non-empty workspace can't be deleted. Reuses the 23-B conventions; no new isolation mechanism.

## The pattern (folder/todo workspace)

- **Folders + standalone to-dos carry workspace via `EventMetadata.WorkspaceId`** (decision #3 — neither is movable, so per-event metadata suffices and avoids versioning `FolderCreated`/`TodoAdded`). `EventEnvelopeFactory.CreateEnvelopes` gained a defaulted `workspaceId`; `FolderCommandHandler`/`TodoCommandHandler` pass `currentWorkspace.WorkspaceId`. `FolderTreeProjection`/`TodoListProjection` read it from `envelope.Metadata.WorkspaceId`.
- **Action-item to-do rows inherit the parent note's workspace** — live path uses `noteDetail.WorkspaceId` (already in hand in `ActionItemCommandHandler`); rebuild path uses a `noteId→workspace` map in `TodoListProjection` fed by `NoteAssignedToWorkspace`.
- `/folders` + `/todos` dual-mapped (rootless + `/w/{workspaceId}`) with self-contained `MapGroup` per endpoint file; list endpoints filter `(user, workspace)` via `ICurrentWorkspace.Includes`.
- **Delete-if-empty is a handler concern, not the aggregate** — the pure `Workspace` aggregate can't query notes, so `WorkspaceCommandHandler.DeleteWorkspace` checks the caller's active (non-deleted) note count in the target workspace via `INoteCardListStore` and throws `WorkspaceNotEmptyException` (→409).

## The non-obvious bit Hawk caught: cross-stream rebuild ordering

`TodoListProjection`'s `_workspaceByNote` map is **not** reliably populated when `ActionItemAdded` is replayed on rebuild. `ReadAllStreamsAsync` orders by **StreamId** (then SequenceNumber), and `action#…` sorts before `note#…`, so an action item's stream replays *before* its note's stream — the map is empty at `ActionItemAdded` time. Correctness comes from the **back-fill loop** in the `NoteAssignedToWorkspace` arm (re-stamps already-seen action rows for the note), **not** from map ordering. The original comment claimed the opposite; corrected so a future reader doesn't "optimise away" the back-fill. Contrast TagIndex (23-B), whose tags live on the *note* stream after the assignment, so its map needs no back-fill.

## Latent coupling flagged for 23-F (move-note)

The live `NoteAssignedToWorkspace` handler (`NoteCommandHandler.ApplyNoteEventsToCard`) re-stamps only the **card** row. Safe today because the event is emitted only at create (no action items yet). When 23-F's `MoveNoteToWorkspace` re-emits it for an existing note, the live path must **also** re-stamp the note's TodoList action rows (the rebuild already back-fills them) or live and rebuild diverge for moved notes. A guard comment was added at the call site.

## Choosing Phase-25-disjoint work

23-C was picked specifically because Phase 25 (media store 25-A, paste-images 25-B, lifecycle 25-C, BUG-17 tag-concurrency) was running in parallel on the same `main`. 23-C's folder/todo/workspace surface is disjoint from media/tags, and I deliberately kept it **off the shared wiring files** Phase 25 edits — `Builder.cs`, `NoteEndpoints.cs`, `Program.cs`, `NoteTakerStack.cs`:
- New `WorkspaceCommandHandler` dependency (`INoteCardListStore`) added as a constructor param — DI resolves it, **no `Builder.cs` edit**.
- `FolderEndpoints`/`TodoEndpoints` self-contain their own `/w/{workspaceId}` `MapGroup` (multiple same-prefix groups coexist; routes are distinct) — **no `Program.cs` edit**.
- No new table → **no `NoteTakerStack.cs` edit**.
Result: a conflict-free merge against a `main` that moved several times during the slice. The lesson: when picking parallel work, disjointness is about the *file set*, not just the feature area — engineer the change to avoid the shared wiring files.

## Notes
- No prod backfill: `WorkspaceId` is additive; historical folder/todo rows resolve to default via `null→default`. `TodoList` has no `ProjectionRebuildHandler` path today (pre-existing); not added here.
- The `TagsJourney` E2E flake did **not** recur — 23-C's deploy was green first try.
