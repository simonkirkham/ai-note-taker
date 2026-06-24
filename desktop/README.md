# AI Note Taker — Desktop (Windows)

Electron **bundle-shell** for the meeting recorder: ships the compiled `web/`
frontend inside the app (loaded from disk), and calls the **live prod API**.
Purpose (Phase 31): remove the per-meeting screen-share picker + consent when
capturing system audio. See [`docs/phases/phase-31.md`](../docs/phases/phase-31.md).

**Not in the prod deploy pipeline.** This is a separate, manually-built artifact —
nothing here runs in `deploy.yml` or `cdk deploy`. Deploy-time impact on prod: none.

## Easiest: pull the published installer (recommended)

CI builds the Windows installer and publishes it to **GitHub Releases** after every
successful prod deploy that changed the frontend/desktop (workflow:
[`publish-desktop.yml`](../.github/workflows/publish-desktop.yml)). To update, just pull
and install it — **no local build, no `node_modules`, no Wine**:

```powershell
npm run update           # version-check → (if newer) download → close app → silent install → relaunch
```

It **version-checks first**: pulls a tiny `build-sha.txt`, compares it to the build you last
installed, and prints "already up to date" and exits if they match — so running it when
nothing changed is instant (no 82 MB download). Requires the **GitHub CLI** (`gh`) installed
and signed in. The artifact always tracks the **latest successfully-deployed** version (the
workflow runs on `Deploy` success), so this keeps the desktop's bundled frontend in lockstep
with the live site. First run on a machine
shows a one-time SmartScreen prompt (unsigned build).

## Build the installer locally

Only needed if you don't want to wait for CI, or `gh` isn't available:

```powershell
# one-time deps (run on Windows so node_modules has Windows-native binaries)
npm install
npm --prefix ../web install

npm run package          # → release/AINoteTaker-Setup-<version>-{x64,arm64}.exe
```

`package` builds **two** installers — native **x64** and **arm64** — so Windows-on-ARM
machines get a native build instead of x64 emulation. The shell has no native Node
modules, so the arm64 build needs no extra rebuild step. Pick the installer matching your
CPU; an x64 build still runs on ARM via emulation if you grab the wrong one.

Double-click the `.exe` in `release/` to install (one-click, per-user, no admin). It adds
a Start-menu + desktop shortcut and launches. The Google client id is baked in — no
environment variable needed.

> **Windows, not WSL.** Build and run on Windows. `node_modules` carries OS-native binaries
> (esbuild, Electron); installing under WSL then running on Windows (or vice-versa) breaks
> the build — reinstall in `web/` and `desktop/` if you ever switch.

## Run from source (dev loop)

```bash
npm install              # once (+ npm --prefix ../web install)
npm run app              # rebuild web + main, then launch — one command
```

`npm run app` = `npm run build && npm start`. Use it while iterating; use `npm run package`
when you want the installed app.

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
