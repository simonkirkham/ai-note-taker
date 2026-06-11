# Phase 26 — Zero-downtime deployments

**Goal:** A `cdk deploy` to main never breaks a live user. Close the two gaps found in the zero-downtime review: (1) the **frontend deploy job** `aws s3 sync … --delete` (`deploy.yml:200`) removes old content-hashed bundles the instant the new ones land, so any browser/CDN still holding the previous `index.html` 404s its bundle on the next reload → **blank app**; (2) the **backend** alias flip is seamless but an instant 100% cutover with **no canary and no automated rollback** — a bad version serves all traffic until a manual re-deploy. Frontend first: it is a real, reproducible user-facing break today and gets strictly worse the moment **[19-I](phase-19.md)** ships dynamic imports. Graduated from the "Zero-downtime deployments" item in `technical-improvements.md`.

## Summary

| Slice | Summary | Status | Depends on |
|-------|---------|--------|------------|
| 26-A | **Frontend zero-downtime deploy.** Two-pass upload (immutable hashed assets, no `--delete`; `index.html` `no-cache`); scope invalidation to entry points not `/*`; S3 lifecycle rule GCs old assets after a grace window instead of deleting them at deploy time. | Not Started | — |
| 26-B | **Chunk-load-error safety net.** A `vite:preloadError` handler reloads once (loop-guarded) to pick up the new `index.html`; the existing error boundary catches dynamic-import failures. Turns a residual stale-chunk miss into a self-heal. | Not Started | — |
| 26-C | **Backend canary + automated rollback.** Wrap the `live` alias in a CodeDeploy `LambdaDeploymentGroup` with linear/canary traffic shifting, wired to the existing error-rate + p99-latency alarms for auto-rollback. | Not Started | — |

> **26-A is the only slice that fixes a current user-facing break** — do it first, and **before or with [19-I](phase-19.md)** (lazy-loading over today's `--delete` strategy escalates the reload-404 into a mid-session crash). **26-B** is the safety net behind 26-A; its value rises with 19-I but it stands alone. **26-C** is a resilience/learning win, not a downtime fix — sequence it last. All three are independently shippable; only the recommended order is fixed, not a hard dependency.

**Learning surface (secondary):** immutable content-hashed assets vs `--delete` and why the latter breaks SPA deploys; CloudFront invalidation scoping and cost (entry-point-only vs `/*`); S3 lifecycle expiry as deferred GC for superseded assets; Vite's `vite:preloadError` recovery contract; CodeDeploy canary/linear traffic shifting on a Lambda **alias** with alarm-based **auto-rollback**, and the SnapStart-published-version interaction.

---

## Background (current deploy shape)

- **Backend is already seamless at the routing layer.** API Gateway routes to the `live` **alias** (`NoteTakerStack.cs:290`, integrations at `:341`/`:355`), not `$LATEST`. `cdk deploy` publishes a new SnapStart version (CDK waits for the snapshot), then atomically repoints the alias; SnapStart restore (~400–650 ms) avoids a cold-start storm. **Missing:** gradual shift + automated rollback (26-C).
- **Frontend deploy (`deploy.yml:199`–`204`, identical in `deploy-test` and `deploy-production`):**
  - `aws s3 sync web/dist/ s3://<bucket>/ --delete` — `--delete` removes old hashed assets immediately; sets **no** `Cache-Control`.
  - `aws cloudfront create-invalidation --paths "/*"` — invalidates the **entire** cache every deploy (cold edge, latency spike, and immutable assets needlessly purged).
- **Severity rises with 19-I.** `web/` is currently **one eager hashed bundle** (no `React.lazy`/dynamic import — confirmed; 19-I is *Not Started*), so the stale-bundle 404 only bites on a hard reload during the invalidation window. Once 19-I introduces dynamic imports over the unchanged `--delete` strategy, the identical 404 becomes a **mid-session feature crash** (`vite:preloadError`).
- **CloudFront wiring:** `DefaultRootObject = "index.html"`; a viewer-request `SpaRoutingFunction` rewrites extensionless paths to `/index.html` (`NoteTakerStack.cs:821`). So invalidating `/index.html` covers SPA route loads.

---

## Slices

### Slice 26-A — Frontend zero-downtime deploy strategy

**User value:** A deploy never blanks the app for a user who loaded the previous version — old bundles stay reachable until in-flight sessions drain.

**Scenarios (GWT):**
- Given a browser holding the previous `index.html`, when a new version deploys and the user reloads during the invalidation window, then the previously-referenced bundle is **still served** (not 404) because old hashed assets were not deleted.
- Given a deploy, when hashed assets upload, then they carry `Cache-Control: public,max-age=31536000,immutable` and are **not** passed to `--delete`.
- Given a deploy, when `index.html` uploads, then it carries a `no-cache` (revalidate) `Cache-Control` so the next request always re-fetches the current entry point.
- Given a deploy, when the cache is invalidated, then only the entry point(s) (`/index.html`, `/`) are invalidated — not `/*` — so immutable assets stay warm at the edge.
- Given assets superseded more than the grace window ago, when the S3 lifecycle rule runs, then they are expired (deferred GC), so storage does not grow unbounded.

**Acceptance criteria:**
- Replace the single `s3 sync … --delete` with a **two-pass** upload in both `deploy-test` and `deploy-production`:
  1. Hashed assets (`web/dist/assets/`) → `--cache-control "public,max-age=31536000,immutable"`, **no `--delete`**.
  2. Entry point(s) (`index.html` + any unhashed root files) → `--cache-control "no-cache"`, **no `--delete`**.
- CloudFront invalidation narrowed from `"/*"` to the entry point(s) (`"/index.html"`; add `"/"` if needed for `DefaultRootObject`).
- New **S3 lifecycle rule** on `WebBucket` (CDK) expiring objects after a grace window (default **30 days**) so superseded assets self-reap instead of being deleted at deploy time.
- **Grace-window caveat handled:** a hashed asset that stays byte-identical (same name) across many deploys is skipped by `s3 sync` and keeps an old `LastModified`, so an age-based rule could expire a still-referenced asset. Mitigation in the slice — re-stamp currently-referenced assets each deploy (e.g. force-set their `Cache-Control` so `LastModified` refreshes) **or** widen the window — chosen and recorded in the slice; a test/assertion guards it.
- Tests: `Infrastructure.Assertions` asserts the bucket lifecycle rule exists with the expected expiry. The `deploy.yml` change is verified by the post-deploy smoke/E2E (app still loads) — note in the PR that the no-`--delete` behaviour is not unit-testable in CI.
- No event-model, aggregate, or runtime backend change.

### Slice 26-B — Chunk-load-error safety net

**User value:** If a browser ever does request a missing chunk (genuinely pruned, flaky network, or a race the deploy change does not cover), the app self-heals with a reload instead of throwing.

**Scenarios (GWT):**
- Given a dynamic import fails (`vite:preloadError`), when the handler fires, then the page reloads once to fetch the current `index.html`.
- Given the reload already happened once (the app just reloaded), when another `vite:preloadError` fires immediately, then it does **not** reload again (no reload loop) and surfaces the error boundary instead.
- Given a dynamic-import failure bubbles to React, when it is caught, then the existing error boundary renders a recoverable fallback (offer reload), not a white screen.

**Acceptance criteria:**
- A global `window.addEventListener('vite:preloadError', …)` handler that calls `location.reload()` once, guarded by a `sessionStorage` flag to prevent a reload loop; the flag clears on a successful load.
- The existing error boundary (Phase 23) catches dynamic-import/chunk-load errors and offers a reload action.
- Tests (Vitest/RTL): dispatching `vite:preloadError` triggers exactly one reload; a second dispatch with the guard flag set does not reload; error-boundary fallback renders on a thrown chunk-load error.
- Pairs with **[19-I](phase-19.md)** (the first dynamic imports) but is independent — valuable even for the current eager bundle on a flaky network.
- **Caveat for 19-I:** the guard flag is cleared on a successful boot, which only proves the *entry* chunk loaded — not every lazy route. With no `React.lazy` yet this is loop-safe, but the first lazy route makes clear-on-boot re-arm the guard before a later route-chunk failure, so a genuinely-missing route chunk could reload-loop instead of falling to the ErrorBoundary. When 19-I lands, move the clear behind a stability signal (e.g. clear after a short delay / first idle) so a same-incident lazy failure still sees the flag set.

### Slice 26-C — Backend canary deploy + automated rollback

**User value:** A bad backend version is caught and rolled back automatically during a gradual traffic shift, instead of serving 100% of users until someone notices and re-deploys.

**Scenarios (GWT):**
- Given a new Lambda version is published, when it deploys, then traffic shifts to it **gradually** (linear/canary) rather than 100% at once.
- Given the `notetaker-error-rate` or `notetaker-p99-latency` alarm trips during the shift, when CodeDeploy observes it, then the deployment **rolls back** to the previous version automatically.
- Given the shift completes with no alarm, then the `live` alias is fully on the new version and the deployment is marked successful.

**Acceptance criteria:**
- Wrap the `live` alias in a CodeDeploy `LambdaDeploymentGroup` with a traffic-shifting config (e.g. `LINEAR_10PERCENT_EVERY_1MINUTE` or `CANARY_10PERCENT_5MINUTES`) and `alarms` = the existing `errorRateAlarm` + `latencyAlarm` so a breach auto-rolls-back.
- Confirm the CodeDeploy + **SnapStart-on-published-versions** interaction (traffic shifts between published versions; document any constraint found).
- **Deploy-time trade-off documented:** the bake window adds minutes to every `cdk deploy`; pick a short config suited to a low-traffic app, and note that an alarm needs traffic to evaluate (so on an idle deploy the shift simply completes).
- Tests: `Infrastructure.Assertions` asserts the deployment group exists, references the alias, and lists both alarms.
- No event-model or frontend change.

---

## Observability

| Risk | Symptom | What to make visible |
|---|---|---|
| Stale-chunk 404 still reachable (grace window too short, or an unhashed asset churns) | Blank app / `vite:preloadError` after a deploy | RUM `JsErrorCount` / `HttpErrorCount` (already on the ops dashboard) spikes post-deploy; 26-B's reload self-heals and the boundary logs it. |
| Lifecycle rule prunes a still-referenced asset | 404 on an old-but-live bundle | The 26-A re-stamp/window guard + `Infrastructure.Assertions` lifecycle test; watch RUM HTTP errors after the window elapses. |
| Canary masks a slow-burn regression that only shows at 100% | No rollback, degraded after full shift | Existing error-rate + latency alarms continue to evaluate post-deploy (they are not canary-scoped); 26-C wires them as the rollback trigger too. |

---

## Constraints

- **Frontend-first, before or with [19-I](phase-19.md).** Do not ship 19-I's dynamic imports onto the current `--delete` deploy — that converts the reload-404 into a mid-session crash.
- **26-A keeps the existing two-job (test → production) deploy flow** — both jobs get the identical two-pass upload + scoped invalidation; no job-graph restructure.
- **26-C lengthens every deploy** by the bake window — accept a short linear/canary config; this is a resilience/learning slice, not a current-downtime fix.
- **No event-model, aggregate, or projection change** anywhere in this phase; 26-A/26-C are infra-only, 26-B is frontend-only.
