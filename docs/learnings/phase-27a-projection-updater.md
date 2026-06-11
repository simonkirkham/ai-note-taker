# 27-A — Extract a shared `ProjectionUpdater`

**Slice:** Phase 27-A · **PR** #243 (squash `1c2abdc`) · **Deploy** #533 green · 2026-06-11.

Behaviour-neutral lift-and-shift: the inline read-model write logic from all 5 command handlers (`Note/ActionItem/Todo/Folder/Workspace`) moved into one scoped `ProjectionUpdater` (`src/Api/Projections/`). Handlers still call it inline at the same flow point. It is the seam the 27-B async projector reuses.

## The one non-obvious decision: feedback-counter idempotency was descoped to 27-B

The drafted 27-A scope said "make every apply idempotent, including the feedback counters." Reading the stores proved that **can't be done cheaply in 27-A**:

| Feedback op | Mechanism | Idempotent on redelivery? |
|---|---|---|
| tag/action `RecordSuggestionAsync` | `ADD SuggestedCount :one` + provenance PUT | **No** — double-counts |
| action `TryRecordCompletion/Deletion` | GET provenance → `ADD …Count` (provenance **not** removed) | **No** — double-counts |
| tag `TryRecordRejectionAsync` | increment then **delete** provenance | Yes (provenance gone 2nd time) |

Making the increment counters redelivery-safe needs one of:
1. a **processed-event marker** (track highest-applied sequence per stream) — a new table/attribute, which 27-A explicitly excludes; or
2. a **counter-model rework** (derive counts from provenance instead of `ADD`) — scope creep with real regression risk.

Both belong with the mechanism that actually *causes* redelivery — the projector. **So the per-stream processed-position guard is now a 27-B deliverable**, and 27-A only did the *cheap, apply-once-equivalent* idempotency: card tag append → append-if-absent, card action-item add → add-if-absent. Everything else (re-fold-from-history title/detail/search, full-PUT todo/tagindex/calendarlink/folder/workspace, set-based card complete/reopen/file/unfile) is idempotent by construction.

**Lesson:** when a slice's acceptance says "make X idempotent," read the *store implementations* before committing — an `ADD`/increment is not an upsert, and retrofitting idempotency onto a counter is a different (bigger) slice than a projection-write extraction. Scope the dedup with the redelivery source, not ahead of it. The phase doc was corrected (27-A/27-B) before any code was written, so no rework — the win was reading the feedback stores during Scout-refinement, not during Pip.

## Faithfulness held because the seam preserved orchestration boundaries

What moved: **projection writes only**. What stayed in handlers: stream read, aggregate rebuild, `AppendAsync`, the OCC retry loop, folder cascade/subtree, workspace delete-if-empty, and — critically — the `AddActionItem` **pre-append note-existence check** (moving it would let a missing note append an orphan action event). Hawk verified all 5 aggregates line-by-line and found no behaviour drift. The `Todo` workspace source changed from `currentWorkspace.WorkspaceId` to `envelope.Metadata.WorkspaceId` — provably equal today (same factory call) and the correct source for the 27-B stream path where no `ICurrentWorkspace` exists.

## Carried forward to 27-B
- Build the **per-stream processed-position guard** (the descoped feedback-counter dedup).
- The `ProjectionUpdater` sources user/workspace from `ICurrentUser`/`envelope.Metadata` today; 27-B must source everything from event metadata (no HTTP request context in the projector).
- Minor: `AddActionItem` now reads `noteDetail` twice (handler precheck + updater). Harmless inline; in the projector the updater's read becomes load-bearing (no handler pre-fetch), so leave it.
