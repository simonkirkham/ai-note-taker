# Phase 54 — Desktop app updates itself

**Goal:** the desktop app downloads each new version in the background and is up to date the next time you open it — no command to paste.

## Summary

| Slice | What the user gets | Status | Depends on |
|-------|--------------------|--------|------------|
| 54-A  | New versions download quietly while you work and install when you close the app; a notice offers "Restart now" | Not Started | — |

One slice: it proves and delivers the whole flow. The copy you have installed today cannot update itself, so the first switch-over needs the existing one-line command once; every update after that is automatic.

## Slices

<!-- REVIEW SURFACE — the human reads this and stops. No technical artefact named below. -->

### Slice 54-A — Background download, install on close

- **User value:** you never have to remember or run anything to stay on the latest desktop version.
- **How it works:**
  - When the app opens, and once an hour after, it checks for a newer version.
  - A newer version downloads in the background. Nothing interrupts you; recording keeps working.
  - Once downloaded, a slim notice says *"An update is ready — it installs when you close the app."* with a **Restart now** button and a dismiss ×.
  - Closing the app installs the update silently. Next time you open it, you are on the new version.
  - **Restart now** is hidden while a recording is running or still saving, so an update can never cut off a meeting.
  - If the automatic update fails (download site unreachable, broken download), today's notice with the copyable command appears instead — you are never left behind silently.
  - The browser version never shows any of this.
- **Scenarios (GWT):**

```
Scenario: Update downloads and installs on close
  Given a newer desktop version has been published
  When  the app opens
  Then  the new version downloads in the background without interrupting me
  When  I close the app and open it again
  Then  I am on the new version

Scenario: Update ready notice
  Given a newer version has finished downloading
  Then  a notice says "An update is ready — it installs when you close the app"
    And it offers a Restart now button

Scenario: Restart now
  Given the update-ready notice is showing
    And nothing is recording
  When  I press Restart now
  Then  the app closes, installs the update and reopens on the new version

Scenario: Recording in progress
  Given the update-ready notice is showing
    And a recording is running or still saving
  Then  the Restart now button is not offered
    And the notice still says it installs when I close the app

Scenario: Up to date
  Given no newer version has been published
  When  the app opens
  Then  no notice appears

Scenario: Download in progress
  Given a newer version is still downloading
  Then  no notice appears yet

Scenario: Automatic update fails
  Given a newer version has been published
    And the automatic download fails
  Then  the notice with the copyable update command appears, as before

Scenario: Dismiss
  Given the update-ready notice is showing
  When  I dismiss it
  Then  it disappears
    And the update still installs when I close the app

Scenario: Browser
  Given I use the app in a web browser
  Then  no update notice ever appears
```

---

## Build notes _(implementation — skip when reviewing)_

### 54-A
- **Events/commands/projections/API/CDK:** none. Desktop shell + `web/` notice + `publish-desktop.yml`.
- **Updater:** `electron-updater` (runtime `dependencies` in `desktop/package.json`, so it ships in the asar). Generic provider at `https://github.com/simonkirkham/ai-note-taker/releases/download/desktop-latest/`, declared as `publish` in `electron-builder.json` → electron-builder writes `latest.yml` into `release/` and bakes `app-update.yml` into resources. Package with `--publish never` (the workflow uploads).
- **Channel pinned to `latest` in the `publish` entry.** Left unset, electron-builder takes the version's prerelease part — the build **date** (`1.0.0-20260918.901` → `20260918.yml`, `channel: 20260918` in `app-update.yml`) — so each copy would look for its own day's manifest and never see a later one. Found by building a real installer locally, not by any spec. Version `1.0.0-YYYYMMDD.run` is valid semver; numeric prerelease identifiers compare numerically, so `semver.gt` orders builds correctly. Do not set `autoUpdater.channel` in code — it flips `allowDowngrade` on.
- **Which installer:** `latest.yml` lists all three installers; electron-updater's `findFile` prefers the one whose name contains `process.arch`, so an x64 machine downloads the ~89 MB `-x64.exe`, not the ~177 MB combined one.
- **Signature:** unsigned build → no `publisherName` → electron-updater skips signature verification. Trust is identical to `update.ps1` today (installs whatever the release holds).
- **Differential download:** not available — the rolling release deletes the previous installer + blockmap, so electron-updater falls back to a full download. Upload the `.blockmap` anyway (harmless; enables it if the release ever keeps history).
- **Main process (`desktop/src/autoUpdate.ts`):** `autoDownload = true`, `autoInstallOnAppQuit = true`; check on ready and every 60 min; skipped when `!app.isPackaged`. State machine `checking | downloading | ready | none | failed` pushed to the renderer on change (`updates:state`), readable on demand (`updates:getState`). `updates:restart` → `quitAndInstall(true, true)` (silent, relaunch). All IPC answers the bundle origin only (`ipcOrigin.ts`). Failures `console.warn` with the reason.
- **Renderer (`UpdateNotice`):** `ready` → update-ready notice; Restart hidden while `useBusyNoteId()` is non-null (recording, or still saving after Stop). `downloading`/`checking` → nothing. `failed`/`none`/bridge absent → existing 53-A behind-notice (copy command) when history says behind. Dismissing the ready notice is session-only state.
- **Publish workflow:** upload `desktop/release/latest.yml` + `desktop/release/*.blockmap` with the existing assets; `test -s desktop/release/latest.yml` runs before the old release is deleted. No `concurrency` group (spec forbids one).
- **Tests:** desktop Playwright unit spec for the state machine (injected fake updater: each event → state; not packaged → no check; failure → `failed`); publish spec for `latest.yml` upload + `publish` config + `electron-updater` in `dependencies`; vitest for each notice scenario.
- **Acceptance criteria:**
  - [ ] A packaged build checks on launch and hourly; dev build never checks
  - [ ] Download completes → ready notice with Restart now
  - [ ] Restart hidden while recording
  - [ ] Failure → 53-A copy-command notice as fallback
  - [ ] Browser → nothing
  - [ ] Release carries `latest.yml` naming the uploaded installer
  - [ ] Watched on Windows: install N, publish N+1, close + reopen → on N+1 (manual; `desktop/MANUAL-VERIFICATION.md`)

### Observability
- Silent failure: `latest.yml` missing or wrong → every check errors → `failed` → fallback notice appears (visible to the user) + `console.warn`.
- Silent failure: install-on-quit never runs → app stays behind → the 53-A behind-count keeps growing and the fallback shows once state is `none`.

### Deploy-time
- Neutral for `deploy.yml`. `publish-desktop.yml` uploads two more small files (seconds, recurring, post-deploy).
