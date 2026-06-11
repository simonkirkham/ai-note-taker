# Phase 26-A — Frontend zero-downtime deploy

**Slice:** 26-A · **PR:** #225 · **Status:** Done

## What shipped

| Change | File |
|---|---|
| Two-pass S3 upload (no `--delete`): hashed `assets/` immutable, then `index.html`+root `no-cache` | `.github/workflows/deploy.yml` (both jobs) |
| CloudFront invalidation narrowed `/*` → `/index.html` + `/` | `.github/workflows/deploy.yml` |
| `WebBucket` lifecycle rule: expire `assets/` after 30 days | `src/Infrastructure/NoteTakerStack.cs` |
| Assertion: lifecycle rule (assets/, 30d, Enabled) | `tests/Infrastructure.Assertions/InfraAssertionsTests.cs` |

## Why (non-obvious)

1. **`s3 sync --delete` breaks SPA deploys.** It removes the previous build's content-hashed bundles the instant the new ones land. A browser or CDN edge still holding the old `index.html` then 404s its referenced bundle on the next load → blank app. Fix: stop deleting; let old assets linger and reap them on a delay.
2. **The lifecycle GC is safe only because of a load-bearing re-stamp invariant.** Age-based expiry could prune a still-referenced hashed asset (a byte-identical asset keeps the same hash filename across builds). It is safe here because a fresh, uncached `npm run build` writes every asset with a newer mtime each deploy, so the default `s3 sync` re-uploads even byte-identical files and refreshes their `LastModified` — keeping any still-referenced asset out of the 30-day window. **Do not cache `web/dist` between CI runs and do not add `--size-only`**, or a live asset could age out and 404 (the exact break this slice fixes). This is guarded by a comment in the deploy step.
3. **Expiry is scoped to `Prefix = "assets/"`** so `index.html` and other unhashed root objects are never GC'd — only Vite's hashed bundles age out.
4. **Invalidation scope:** `DefaultRootObject = index.html` + the `SpaRoutingFunction` rewrite means invalidating `/index.html` (+`/`) covers every SPA route load; hashed assets are immutable and rename-on-change, so they never need invalidating and stay warm at the edge.

## Testing note

The no-`--delete` / two-pass behaviour is **not** unit-testable in CI — only the lifecycle rule is asserted. The upload behaviour is covered by the post-deploy smoke/E2E (app still loads).
