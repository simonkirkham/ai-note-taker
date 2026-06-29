# Phase 23-B — Scope the write path + note read models (keystone)

**Shipped:** PR #214. The conventions every later 23 slice copies: a second isolation dimension (workspace) retrofitted across the note write path and five read models, with **no event-log migration**.

## The pattern (what 23-C..G copy)

1. **Note workspace = domain state, not metadata.** `NoteAssignedToWorkspace { NoteId, WorkspaceId }` is emitted by `CreateNote` (and `MoveNoteToWorkspace` in 23-F) and folded on the `Note` aggregate (`_workspaceId`, default `WorkspaceId.Default`). Every note-derived projection folds it to set its `WorkspaceId`. This mirrors `NoteFiledInFolder` (container-membership-as-event).
2. **`EventMetadata.WorkspaceId`** (nullable, defaulted 5th positional) records the workspace a write happened in — for **folders/todos** (23-C, which are not movable so per-event metadata suffices). Note read models do **not** use it; they fold the domain event. Adding it as a defaulted param preserved ~25 existing 4-arg constructions and old-event JSON (absent → null).
3. **`/w/{workspaceId}` route group + rootless dual-map.** One helper (`MapWorkspaceScopedRoutes`) maps every note/content route, called twice: once on `app` (rootless → `ICurrentWorkspace` resolves to default, keeps the pre-23-D frontend working) and once on `app.MapGroup("/w/{workspaceId}").AddEndpointFilter<WorkspaceValidationFilter>()` (404s another user's workspace before the handler). Literal-segment routing means `/notes/cards` still beats `/notes/{noteId}` under the group.
4. **`null → default` at read.** Historical rows (no `WorkspaceId` attribute) resolve to `__default__` via `ICurrentWorkspace.Includes(rowWorkspaceId)`. **No backfill** — a rebuild re-derives null for pre-23-B notes (they have no assignment event), so the default mapping is the migration.
5. **No DynamoDB key-schema change.** `WorkspaceId` is an additive attribute; `NoteSearchView`'s `UserId-index` GSI is `ProjectionType.ALL`, so it auto-projects it and the workspace filter runs in-Lambda after the per-user query. (Verified by a DynamoDB-Local round-trip test.)

## The keystone bug Hawk caught (live ≠ rebuild)
`TagIndex` live writes initially stamped `currentWorkspace.WorkspaceId` (the **request route's** workspace), while the rebuild path derives the workspace from the note's `NoteAssignedToWorkspace` (the **note's** workspace). Because `PostTag` validates note ownership by id but not route-workspace, tagging note-A via `/w/B/notes/{A}/tags` would bucket the tag to B live but A on a rebuild — a silent live/rebuild divergence. **Fix:** derive the tag's workspace from the note's current `NoteDetailView.WorkspaceId` (already rebuilt in the handler), so live == rebuild exactly. **Lesson for every later slice:** when a read model's live-path write and its rebuild-path fold can pull a value from two different sources (request context vs domain event), they *will* diverge under an off-axis request — derive both from the event/aggregate, never from the request.

## Deliberate scope decisions (not oversights)
- **Point reads/mutations of a single note stay user-scoped by id.** A note from workspace A accessed by id under `/w/B` is the user's own data — not a cross-tenant leak. The isolation that matters is the **list/search** surface (cards, titles, search, tags), which is where A's content would otherwise show under B. `GetNote` deliberately does **not** 404 on workspace mismatch (keeps deep links robust for 23-D).
- **`NoteActions` carries no `WorkspaceId`** — scoped transitively via its parent note (never listed cross-note). A per-row workspace earns nothing there.

## Follow-ups (tracked, not done here)
- **Meeting-created notes land in `__default__`** — `CalendarEndpoints` `from-meeting`/`from-next-occurrence` are mapped rootless only, so `ICurrentWorkspace` resolves to default. Correct for 23-B (frontend can't send `/w/` yet); **23-D/23-G must also map them under the workspace group** or they silently keep writing to default post-prefix-adoption.
- **`WorkspaceValidationFilter` does a full table `Scan`** per scoped request for the ownership check (same `Scan`-vs-GSI theme as the 23-A tech-debt note). Fine at current scale; fold a point `Get` in when the workspace store gains a per-user index.

## Process
- The `TagsJourney.RemoveTag_GoneAfterNavigation` E2E flake gated the deploy **again** (2nd phase-23 occurrence; also hit 23-A). Both change-independent, cleared on `gh run rerun --failed`. It's already an open item in `technical-improvements.md` — the repeat across unrelated backend slices reinforces that it should be fixed, not re-run.
- Main moved fast during this slice (parallel sessions: MPI eval, cold-start refresh, modal focus-trap, a CI-workflow change). Merge waited out an in-progress CI-change deploy; no conflicts (those touched `web/`/`.github/`/`eval/`, disjoint from the backend surface).
- Node 24 local vs CI Node 20: restored `web/package-lock.json` before each commit (the standing guardrail).
