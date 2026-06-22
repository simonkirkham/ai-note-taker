# AI Note Taker — Desktop (Windows)

Electron **bundle-shell** for the meeting recorder: ships the compiled `web/`
frontend inside the app (loaded from disk), and calls the **live prod API**.
Purpose (Phase 31): remove the per-meeting screen-share picker + consent when
capturing system audio. See [`docs/phases/phase-31.md`](../docs/phases/phase-31.md).

**Not in the prod deploy pipeline.** This is a separate, manually-built artifact —
nothing here runs in `deploy.yml` or `cdk deploy`. Deploy-time impact on prod: none.

## Build & run (after Pip lands 31-A)

```bash
npm install
npm run build      # build:web (vite build + copy to web-dist) then build:main (tsc)
npm start          # launch the Electron app
```

## Test

```bash
npm run test:e2e            # Playwright drives the real Electron app (Node-only API)
# CI (headless Linux): xvfb-run -a npm run test:e2e
```

Automated tests cover shell launch + bundled-asset render only. Real Google
sign-in and restart-persistence are manual — see [MANUAL-VERIFICATION.md](MANUAL-VERIFICATION.md).

## Slices

| Slice | Adds |
|-------|------|
| 31-A | Electron shell, bundled-frontend load, in-window sign-in (this) |
| 31-B | `setDisplayMediaRequestHandler` auto-grant — record with no picker |
| 31-C | `electron-builder` unsigned Windows installer |
