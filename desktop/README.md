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

Two tiers:

```bash
npm run test:server   # portable — loopback server + /api proxy logic (no Electron, no display)
npm run test:e2e      # full — drives the real Electron app; needs a display + GUI libs
# headless Linux CI: xvfb-run -a npm run test:e2e (also needs libnss3, libgbm, etc.)
```

- `test:server` (`tests/server.spec.ts`) covers the risky integration: serving the
  bundle from local assets, SPA fallback, and the `/api` proxy forwarding
  `Authorization` + rewriting the `Set-Cookie` `Domain` to localhost. Runs anywhere.
- `test:e2e` (`tests/shell.e2e.ts`) covers Electron launch + bundled-frontend render
  + `contextIsolation`. Requires a desktop/X environment (Windows, or Linux with
  `xvfb` and Electron's shared libs).
- Real Google sign-in + restart-persistence are manual — see
  [MANUAL-VERIFICATION.md](MANUAL-VERIFICATION.md).

## Slices

| Slice | Adds |
|-------|------|
| 31-A | Electron shell, bundled-frontend load, in-window sign-in (this) |
| 31-B | `setDisplayMediaRequestHandler` auto-grant — record with no picker |
| 31-C | `electron-builder` unsigned Windows installer |
