# Phase 36-A — Per-workspace theme (set & apply)

Slice: server-stored theme per workspace — `WorkspaceThemeSet` event → `Theme` on `WorkspaceListView` → `PATCH /workspaces/{id}/theme` → workspace-scoped `ThemePicker` (PR #351, deploy #650).

## The real lesson — an optimistic DOM paint must flow through the single source of truth, or rollback can't revert it

The first cut painted the new theme **imperatively** in the click handler *and* updated the optimistic cache:

```ts
applyTheme(next);                 // imperative DOM write
mutation.mutate({ workspaceId, theme: next });   // onMutate optimistically sets cache → effect paints
```

The DOM theme is otherwise derived by an effect: `useEffect(() => applyTheme(effective), [effective])`, where `effective` reads the (optimistic) cache. On a **failed** PATCH the cache rolls back (`next → prior`), so `effective` goes `prior → next → prior`. If React coalesces the optimistic and rollback renders into one (fast-failing request), the effect's dependency only ever observes `prior → prior` — **the effect never fires to undo the imperative `applyTheme(next)`, and the DOM stays stuck on the failed theme.** Hawk's review flagged the missing rollback test; the test then reproduced exactly this.

**Fix:** delete the imperative paint. Let the optimistic *cache* write be the only trigger — the effect is the sole writer of the DOM. Now every transition (`prior → next → prior`) is a real dependency change the effect observes, so rollback reliably re-applies the prior theme.

**Generalises:** when an optimistic mutation has a side effect derived from state via an effect (DOM attribute, focus, scroll, title), drive it **only** from the optimistic state — never also imperatively. A second out-of-band write has no corresponding rollback and desyncs on error. A rollback-path test is the thing that catches it (a success-path test can't).

## Design decisions

| Decision | Why |
|---|---|
| Reuse the existing 12 `[data-theme]` themes + `ThemePicker` wholesale | A per-workspace theme = pick one existing theme. "Accent-only" would need a *new* per-attribute token layer — more work and less capable. |
| Default workspace keeps the global `localStorage` theme | `__default__` is a shared cross-user stream (same constraint Phase 34 hit) — a `WorkspaceThemeSet` there would theme it for everyone. Per-user default-workspace theme is a future refinement. |
| Unset theme = global default; no backfill | A new field on an existing view reads null for old rows → renders the default. Unlike a *new projection*, no rebuild needed. |
| Ownership mirrors `RenameWorkspace`/`DeleteWorkspace` (projection `OwnsAsync` + stream existence check) | Parity over a one-off event-stream auth path — fail-closed, and the UI gates the picker behind the consistency-gated `GET /workspaces`. Cross-cutting migration tracked as **TI-51**. |

## Process note

This slice was caught in an unrelated **main-destruction incident**: a parallel session's scribe commit (`996ab9d`) mass-deleted 1056 files (the whole repo bar 2 docs) — a `git add -A`/`commit -a` over a wiped tree. It blocked the merge until `origin/main` was reverted (`fa2540b`). Slice work was safe on its branch throughout. Lesson for scribe automation: never `git add -A` — stage docs by explicit path.
