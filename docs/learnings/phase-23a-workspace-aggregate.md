# Phase 23-A — Workspace aggregate + CRUD + WorkspaceList projection

**Shipped:** PR #207. New `Workspace` aggregate (create/rename/delete), `WorkspaceList` projection + `notetaker-proj-workspacelist` table, `/workspaces` CRUD. Foundation only — no content scoping yet (that is 23-B, the keystone).

## The non-obvious bits

### The default workspace is virtual — never persisted
The reserved default (`__default__`, name "Personal") is **synthesised at read time** in `WorkspaceHandlers.GetWorkspaces`, per caller, when no `__default__` row exists. It is never written to DynamoDB and never deletable (`DELETE /workspaces/__default__` → `409`).

Why this matters for the table key: a persisted default would need a **composite (UserId, WorkspaceId)** key, because `__default__` is the *same string for every user* and would collide on a `PK = WorkspaceId` table. By keeping the default virtual and only ever persisting **globally-unique GUID (`N`-format)** ids, `PK = WorkspaceId` stays collision-free and matches the existing `FolderTree` shape (scan + filter `UserId` in the handler). The sentinel and the GUID space are disjoint, so there is no ambiguity.

### Consequence: renaming the default is deferred
Because the default has no stored row (and no event stream), renaming it is **not supported in 23-A** — `PATCH /workspaces/__default__` fails the ownership check → `404`. No 23-A scenario renames the default. If it is ever needed, it is an additive change (seed a synthetic `WorkspaceCreated(__default__, "Personal")` on first rename, or move to a composite key); do not retrofit it speculatively.

### Where the "default is undeletable" rule lives
Two layers, deliberately:
- **Aggregate** (`Workspace.HandleDelete`) throws `DefaultWorkspaceUndeletableException : InvalidOperationException` if `cmd.WorkspaceId.IsDefault` — checked **before** the exists check so the empty-history default yields `409`, not a `404`-flavoured "does not exist". This is the pure, spec-testable rule.
- **HTTP handler** short-circuits `id.IsDefault` → `Conflict` before loading. Belt-and-suspenders; the aggregate rule is the source of truth (covered by `DeleteWorkspaceSpec.RejectsDeleteOfDefaultWorkspace`).

`DefaultWorkspaceUndeletableException` derives from `InvalidOperationException` so `CommandInstrumentation` counts it as a domain violation (Warning + `CommandFailed`), not a 500. `WorkspaceNotFoundException` was added to both `CommandInstrumentation.IsDomainViolation` and `LoggingConfig.Map` (→ 404) for parity with `FolderNotFoundException`.

## Backfill note (projection-adding slice)
`WorkspaceList` ships empty. Unlike Phase 22 search, there is **nothing to backfill** at 23-A: the `Workspace*` event types did not exist before this deploy, so the live count is 0 and a rebuild produces 0 rows. The meaningful workspace backfill is the `null→default` resolution across note-derived projections, which lands with **23-B/23-G** (when `NoteAssignedToWorkspace` and `EventMetadata.WorkspaceId` exist). The rebuild handler was still wired for `WorkspaceList` (build loop + upsert + stale-reconcile + count) so it is correct from the first event.

## Follow-up (non-blocking, from Hawk)
`DynamoDbWorkspaceListStore.GetAllAsync` is a full cross-user `Scan`, called on every `GET /workspaces`, rename, and ownership check — where `NoteSearchView` uses a per-user `UserId-index` GSI + `Query`. Acceptable at current scale (workspaces-per-user is tiny) but an architectural inconsistency. Logged in `technical-improvements.md`; fold a `UserId` GSI in if 23-B's scoping work touches this store.

## Process
- Single Pip pass off an upfront read of the closest precedents (`Folder` aggregate/handler/projection/store, `ProjectionRebuildHandler`, CDK table + infra assertions, `ApiFactory`). No mid-slice surprises.
- Local Node 24 vs CI Node 20: `npm --prefix web install` in the fresh worktree rewrote `web/package-lock.json` even though no dependency changed — restored it before committing (the existing CLAUDE.md guardrail, hit in practice).
- Deploy flaked once on the unrelated `TagsJourney.RemoveTag_GoneAfterNavigation` E2E (the known pre-existing tag flake); `gh run rerun --failed` cleared it. Change-independent — 23-A is backend-only.
