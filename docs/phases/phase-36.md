# Phase 36 — Theme per workspace

**Goal:** let each **workspace** carry its own visual theme, so the active workspace's look switches automatically on workspace change — a fast way to tell a client workspace from a personal one at a glance. Theme today is **global** (one `[data-theme]` on `<html>`, 12 themes in `tokens.css`, persisted in the `note-taker-theme` localStorage key; see `frontend-react` theming notes). This phase makes the theme a **server-stored, per-workspace setting**: a new additive `WorkspaceThemeSet` event on the existing `Workspace` aggregate, folded into `WorkspaceListView`, read back over the existing `GET /workspaces`. **Full theme, reused** — a workspace picks one of the existing 12 themes (full palette + light/dark), reusing `tokens.css`/`ThemePicker` wholesale; no new token model. Builds directly on the Phase 34 per-workspace pattern (event → projection field → `/workspaces` route → settings UI) and the design-token theming already in `web/`.

## Summary

| Slice | Summary | Status | Depends on |
|-------|---------|--------|------------|
| 36-A | **Set & apply per-workspace theme (keystone).** `WorkspaceThemeSet` event + `SetWorkspaceTheme` command on `Workspace`; `Theme` folded into `WorkspaceListView` (mapped in **both** stores + round-trip test); `PATCH /workspaces/{id}/theme`; the existing sidebar `ThemePicker` becomes workspace-scoped — picking a theme optimistically applies it and persists it to the active **non-default** workspace; switching workspace applies that workspace's stored theme. Proves the full event→projection→route→apply flow on one real call. | Done | — |
| 36-B | **FOUC-free cold load.** Cache each workspace's resolved theme client-side keyed by `wsId`; the `index.html` bootstrap reads `wsId` from the URL and applies the cached theme before React mounts — removes the brief default-theme flash 36-A leaves on a hard reload of a themed workspace. Pure refinement on the proven pattern. | Not Started | 36-A |

**36-A is the keystone** — the cross-cutting contract is "a workspace-scoped setting read from an **async** projection and applied to the global `<html>` theme attribute on switch", proven on one workspace. 36-B is an independent polish (cold-load flash) and ships alone.

### Locked decisions

1. **Server-stored (event + projection), full theme.** A new additive `WorkspaceThemeSet(workspaceId, theme)` event → `Theme` on `WorkspaceListView`. `theme` is one of the existing 12 theme names; stored as an opaque string (an unknown value falls through the `[data-theme]` cascade to the `:root` default — graceful, so the domain stays permissive, non-empty only). Cross-device consistent; matches Phase 34.
2. **Reuse the existing 12 themes and the existing `ThemePicker`** — no accent-only token split, no new component. The sidebar picker (today a global control next to the `WorkspaceSwitcher`) is repurposed to set the **active workspace's** theme and to show that workspace's current theme.
3. **Default workspace keeps the existing global theme.** The `__default__` workspace stream is shared across users (no per-user aggregate — same constraint Phase 34 hit for calendar), so a `WorkspaceThemeSet` event there would theme it for everyone. When the default workspace is active, the picker behaves exactly as today (global `note-taker-theme` localStorage). Server-storing the default-workspace theme **per user** is a future refinement, out of scope. The proving call in 36-A is therefore a **non-default** workspace.
4. **Unset = global default.** A workspace with no `WorkspaceThemeSet` reads `Theme = null` and renders the current default theme. No backfill needed (this is why an empty projection field is harmless here — unlike a projection-adding slice).
5. **No new projection, no new table.** Extends the existing `WorkspaceListView`. Deploy-time **neutral**.

### Deploy-time impact

**Neutral.** One additive event type, one new field on an existing projection/table, one new route on the existing Command Lambda. No new infra, no traffic-shifting, no backfill. Confirm and state the delta in the 36-A PR.

### Observability

| Slice | Silent failure mode | Make it visible |
|-------|--------------------|-----------------|
| 36-A | `Theme` field not mapped in `DynamoDbWorkspaceListStore` → evaporates at the DynamoDB boundary, in-memory tests stay green (the documented `*View` guardrail). | Mandatory `EventStore.Integration` round-trip test (set → `UpsertAsync` → `GetAsync` → assert `Theme` survived). Map in **both** `UpsertAsync` and `MapItemTo…`. |
| 36-A | Theme PATCH lands but the async projection lags → picker/list shows the prior theme briefly. | Expected RYW lag — `PATCH` sets `X-Consistency-Token`, `GET /workspaces` is consistency-gated (existing pattern). Optimistic UI hides it for the actor. |
| 36-A | Ownership check for `PATCH …/theme` reads the **async** `WorkspaceListView` → could 404 while the projector lags right after workspace create (BUG-30 class). | **Shipped:** mirrors `RenameWorkspace`/`DeleteWorkspace` (fail-closed projection `OwnsAsync` + event-stream existence check); UI gates the picker behind the consistency-gated `GET /workspaces`, so the window isn't reachable. Cross-cutting event-stream-ownership migration tracked in `technical-improvements.md`. |
| 36-A | A theme PATCHes but never visibly applies (apply-on-switch silently no-ops). | Structured log on theme apply (`workspaceId`, `theme`) in `useTheme`/the workspace-switch path; surfaces in RUM. |

---

## Slice 36-A — Set & apply per-workspace theme (keystone)

**User value:** in a (non-default) workspace, the owner picks a theme from the sidebar; it applies instantly, persists server-side, and re-appears when they return to that workspace — while a different workspace keeps its own theme.

### Scenarios (GWT-line)

**Domain — `Workspace`**
- Given a workspace, When `SetWorkspaceTheme("midnight")`, Then `WorkspaceThemeSet(id, "midnight")` is raised.
- Given a workspace themed `"midnight"`, When `SetWorkspaceTheme("teal")`, Then `WorkspaceThemeSet(id, "teal")` is raised (re-theme allowed).
- Given a deleted workspace, When `SetWorkspaceTheme("midnight")`, Then it is rejected.
- Given a workspace, When `SetWorkspaceTheme("")`, Then it is rejected (non-empty theme).

**Projection — `WorkspaceListProjection` / `WorkspaceListView`**
- Given `WorkspaceCreated` then `WorkspaceThemeSet("midnight")`, Then the view's `Theme == "midnight"`.
- Given only `WorkspaceCreated`, Then the view's `Theme == null` (unset).

**EventStore integration (DynamoDB-Local)**
- Given a `WorkspaceListView` with `Theme == "midnight"`, When `UpsertAsync` then `GetAsync`, Then `Theme == "midnight"` survives the round-trip.

**API**
- Given a workspace the caller owns, When `PATCH /workspaces/{id}/theme {theme:"midnight"}`, Then `200` + `X-Consistency-Token`; a consistency-gated `GET /workspaces` shows `theme:"midnight"`.
- Given a workspace the caller does **not** own (or unknown id), When `PATCH …/theme`, Then `404` (ownership mirrors the existing `RenameWorkspace`/`DeleteWorkspace` handlers — see the ownership note in Acceptance criteria).
- Given an empty/missing `theme` body, When `PATCH …/theme`, Then `400`.

**Frontend (web/)**
- Given a non-default workspace is active, When the user picks a theme, Then `<html data-theme>` updates **immediately** (optimistic) and a `PATCH …/theme` is sent; on error the prior theme is restored.
- Given two workspaces with different stored themes, When the user switches between them, Then `<html data-theme>` reflects each workspace's stored theme.
- Given the **default** workspace is active, When the user picks a theme, Then it persists to the global `note-taker-theme` localStorage (today's behaviour) — no API call.
- Given a workspace with no stored theme, When it becomes active, Then the global default theme renders.

**E2E (Browser.E2E, reload-tolerant, gated read)**
- Set a theme on a non-default workspace → reload → `<html data-theme>` still reflects it (proves the server round-trip; assert via the consistency-gated workspace list, wrapped in a reload-to-re-gate wait).

### Acceptance criteria

- `WorkspaceThemeSet` is a brand-new additive event, registered in `EventDeserializer` at version 1 (new type — no narrowing of an existing arm needed); existing events untouched.
- Event added to `docs/event-model.md`; wire shape to `docs/event-schemas.md`; the `Theme` view field to `docs/view-schemas.md`.
- `Theme` mapped in **both** `InMemoryWorkspaceListStore` and `DynamoDbWorkspaceListStore` (`UpsertAsync` + `MapItemTo…`), with the round-trip integration test above.
- `PATCH /workspaces/{id}/theme` follows the existing workspace-mutation pattern (auth, `X-Consistency-Token`); the endpoint does HTTP only, the `WorkspaceCommandHandler` owns orchestration and updates the projection inline per the command-handler convention.
- Ownership/existence for the PATCH **mirrors the existing `RenameWorkspace`/`DeleteWorkspace` handlers** (shipped): projection-based `OwnsAsync` (`IWorkspaceListStore`) **plus** the command handler's event-stream existence check (`history.Count == 0 → WorkspaceNotFoundException`). The projection check is **fail-closed** (a lagging projector can only false-*deny*, never cross-user-grant) and in the real flow the picker only enables after the consistency-gated `GET /workspaces` resolves, so the racy-404 window isn't reachable via the UI. Migrating all three workspace-mutation handlers to pure event-stream ownership is tracked as a cross-cutting technical-improvement (do not diverge one handler) — see `docs/technical-improvements.md`. *(Original AC required event-stream-only ownership; relaxed to codebase parity per Hawk review on PR #351.)*
- **Optimistic UI** (mandatory): theme applies before the API responds; reconcile on error — mirror the nearest existing workspace mutation in `useWorkspaceMutations`.
- No backfill (unset theme = default).
- Deploy-time delta stated in the PR (expected neutral).

---

## Slice 36-B — FOUC-free cold load

**User value:** a hard reload of a themed workspace shows that workspace's theme immediately — no flash of the default theme.

### Scenarios (GWT-line)

- Given a workspace was last seen with theme `"midnight"`, When the page cold-loads at `/w/{wsId}`, Then the bootstrap applies `"midnight"` **before** React mounts (no flash).
- Given `useTheme` applies a workspace's theme, Then it caches `{wsId → theme}` in localStorage for the bootstrap to read next cold load.
- Given no cached theme for the URL's `wsId`, When the page cold-loads, Then the current global default applies (status quo).

### Acceptance criteria

- The `index.html` bootstrap script reads `wsId` from the URL path and the cached per-workspace theme from localStorage, applying `data-theme` pre-mount.
- The bootstrap's valid-theme list stays in sync with `useTheme` (existing `frontend-react` guardrail).
- No flash on hard reload of a themed non-default workspace (verified manually / via the 36-A E2E reload step).

**Raised in:** future-features "Theme per workspace" (2026-06-25); graduated to Phase 36 (2026-06-25).
