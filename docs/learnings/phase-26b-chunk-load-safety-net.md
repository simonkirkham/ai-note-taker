# Phase 26-B — Chunk-load-error safety net

**Slice:** 26-B · **PR:** #227 · **Status:** Done

## What shipped

| Change | File |
|---|---|
| `vite:preloadError` handler: reload once, sessionStorage-guarded; clear flag on successful boot | `web/src/lib/chunkReload.ts`, `web/src/main.tsx` |
| ErrorBoundary already catches dynamic-import failures → recoverable Reload fallback (test added) | `web/src/components/ErrorBoundary.tsx` (unchanged), `web/src/__tests__/ErrorBoundary.test.tsx` |

## Why (non-obvious)

1. **`event.preventDefault()` on `vite:preloadError` is load-bearing and asymmetric.** First incident: `preventDefault()` suppresses Vite's default re-throw so a *reload* — not a crash — happens. Guarded second incident: deliberately do **not** `preventDefault`, so Vite re-throws and the failed import bubbles to the ErrorBoundary instead of looping. Both halves are tested.
2. **The guard flag is per-incident, not per-session.** It is cleared on a successful boot so each deploy's stale-chunk error can self-heal once — not "one reload ever."
3. **Flag-clear timing has a latent trap for 19-I (recorded in `phase-26.md` 26-B caveat).** The clear runs after `createRoot().render()`, which proves only the *entry* chunk loaded — not every lazy route. With no `React.lazy` today this is loop-safe. Once 19-I adds lazy routes, clear-on-boot re-arms the guard before a later route-chunk failure, so a genuinely-missing route chunk could reload-loop. Fix when 19-I lands: move the clear behind a stability signal (short delay / first idle) so a same-incident lazy failure still sees the flag set.

## Note

Frontend-only, no new visible surface (reuses the existing ErrorBoundary) — no Stylist, optimistic-UI N/A (no mutation).
