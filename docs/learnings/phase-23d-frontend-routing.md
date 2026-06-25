# Phase 23-D — Frontend workspace routing + context

**Shipped:** PR #230. The SPA is now workspace-addressed: every screen lives under `/w/:wsId`, `/` and unknown paths redirect to `/w/__default__`, and the api client targets the active workspace. Still single (default) workspace — the switcher UI is 23-E.

## The crux: a non-React api client needs the workspace, and timing matters

`api/client.ts` is a plain module, not a React component — it can't read context. So the active workspace lives in a **module-global** (`workspace/workspaceStore.ts`), mirroring `auth/tokenStore.ts`. `WorkspaceProvider` reads the `/w/:wsId` route param and writes it to the store.

**Write it synchronously during render, NOT in an effect.** `AppContent`'s `useNoteCards` fires on the *same* commit as the provider renders. An effect-based sync runs after children render, so the first fetch after mount/switch would read the stale store and target the wrong workspace. The render-time write is a plain module-global mutation (not React `setState`), so it doesn't trip `react-hooks/set-state-in-effect` and causes no tearing/re-render. Guard it (`if (getWorkspaceId() !== wsId)`) so StrictMode double-invoke is harmless.

## Query keys via getters — wsId with zero call-site churn

`queryKeys.ts` keys became **getters** that fold `getWorkspaceId()` in at access time (`get noteCards() { return ["noteCards", getWorkspaceId()] }`). Every call site (`keys.noteCards`, `keys.note(id)`) is unchanged, but each now resolves to a per-workspace key. A `useQuery` and its invalidations re-read the same getter within a render, so they never diverge. `WorkspaceProvider` also `qc.removeQueries()` on a workspace switch (the no-stale-flash guarantee). `keys.meetings` stays global — the calendar is per-user, not per-workspace.

## The test-blast-radius pivot (and parallel repair)

First attempt prefixed *unconditionally* in the api client → **127 vitest tests broke** (component tests assert rootless `/api/...` everywhere). The fix was a design change, not a test slog: **only prefix when the store is set.** Component tests render a subtree without `WorkspaceProvider` → store empty → rootless requests → existing handlers match untouched. Only full-App tests (which mount the provider) send prefixed requests. That cut breakage 127 → 23 (8 files). Then **3 subagents fixed those 8 disjoint files in parallel** (uniform transform: prefix URL assertions `/…`→`/w/__default__/…` and `server.use` overrides `/api/…`→`/api/w/:wsId/…`).

Two supporting pieces:
- `test/handlers.ts` registers **both** rootless and `/w/:wsId` forms via a `scoped()` helper — subtree tests stay rootless, full-App tests run prefixed, zero per-test churn.
- The module-global workspace is **reset in `setup.ts` afterEach** — it's process-wide state and would otherwise leak a `/w/:wsId` prefix from one test's full-App render into the next (the same class of hazard the env-var-restore guardrail covers).

## Follow-up (from Hawk, latent for 23-E)

Meeting-created notes (`/notes/from-meeting`, `/notes/from-next-occurrence`) are in the api-client **global denylist** → sent rootless → backend resolves to `__default__`. Correct for 23-D (those backend routes are rootless-only; prefixing would 404) but a gap once 23-E enables real switching: a meeting-created note will ignore the active workspace until the calendar routes adopt the `/w` prefix (a 23-E/backend follow-up). Already flagged in [phase-23b](phase-23b-scope-note-readmodels.md).

## Deploy note (not a 23-D issue)

23-D is frontend-only (backend Lambda unchanged) yet its deploy *failed* — a parallel session's **26-C "canary deploy + automated rollback"** gated the Lambda alias shift on the `notetaker-p99-latency` alarm, which tripped on a cold-start/SnapStart spike during the traffic shift and rolled back. The owning session reverted 26-C; 23-D rode to production on the revert deploy. Lesson for alarm-gated Lambda deploys: a tight p99 alarm + SnapStart cold-start latency during the canary window causes spurious rollbacks even for no-op backend deploys.
