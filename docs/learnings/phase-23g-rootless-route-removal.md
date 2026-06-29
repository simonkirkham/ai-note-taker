# 23-G — removing the rootless fallback routes

**Slice:** 23-G (workspace cleanup). Removed the pre-23-D rootless content routes so every content endpoint is `/w/{workspaceId}`-only.

## Two non-obvious findings

### 1. A latent rootless-only route the migration never prefixed

`/notes/{id}/transcription`, `/transcription/draft`, and `/notes/{id}/analyse` were mapped in `TranscriptionEndpoints` as **rootless-only** — they were never dual-mapped under `/w/{wsId}` when 23-B/23-C added the prefixed group. The production frontend (which prefixes scoped paths once the workspace store is set) was already calling `/w/{wsId}/notes/{id}/analyse`, so these were a latent 404 waiting for any non-default-workspace use. Removing the rootless routes surfaced it (integration tests 404'd). Fix: move them under the prefixed group.

**Takeaway:** when a slice dual-maps "all content routes," audit *every* endpoint file, not just the obvious one. A route registered in a sibling endpoint file is easy to miss; the cleanup slice is where it bites.

### 2. Migrating ~32 test files without touching them: a test-server `IStartupFilter`

The suite has 32 files calling un-prefixed scoped paths (`/notes`, `/folders`, …) for brevity. Rather than rewrite them all, an `IStartupFilter` registered in `ApiFactory.ConfigureTestServices` rewrites un-prefixed scoped paths to `/w/__default__` **before routing**.

Why a startup filter and not an `HttpMessageHandler` on the client:
- A per-client `DelegatingHandler` misses `WithWebHostBuilder`-derived clients (they call the base `CreateClient`, not the override) — that left 7 tests failing.
- A server-side filter sits in the shared pipeline, so it covers **every** client uniformly.
- An `X-Test-No-Prefix` opt-out header lets a `CreateRawClient` assert the rootless paths genuinely 404.

**Watch-outs:** exclude the genuinely-global `/notes/*` paths (`/notes/from-meeting`, `/notes/from-next-occurrence`) from the rewrite — they mirror the frontend's `GLOBAL_PATH_PREFIXES`. And **a test that used to assert "rootless works" must be retired** — with the rewrite in place it would silently contradict the new "rootless 404s" test.

### 3. Removing a route breaks post-deploy smoke tests too — and the test shim hides it

The `IStartupFilter` made the whole `Api.Integration` suite pass, which gave false confidence. **`Api.Smoke` has no shim** — it hits the *real* deployed API. It still called rootless `/notes`, `/todos`, `/tags`, `/folders`, so `deploy-test` failed post-deploy (`deploy-production` was gated off, leaving main red and prod behind one merge). Fixed in a follow-up by prefixing the smoke paths with `/w/__default__`.

**Takeaway:** when removing/renaming a route, `grep` **every** test project for the path, especially the ones that run against a live deployment (`Api.Smoke`, `Browser.E2E`) — the in-process test shim that keeps the unit/integration suite green will mask the breakage that only surfaces at deploy time. A green PR CI is not enough when the change alters the live API surface.

## Frontend: no change needed

The api-client's `if (!wsId) return path` rootless branch is now **test-only** (msw intercepts; prod always sets the store via `WorkspaceProvider`). Forcing always-prefix broke 104 component tests for zero prod benefit — left it as a documented test affordance. See [[phase-23f-move-note-rebuild-divergence]] and [[workspace-switch-removequeries-stuck-loading]] for the other Phase 23 tail learnings.
