# Phase 53 — Update notice in the desktop app _(Not Started)_

**Goal:** the desktop app tells you when a newer version is out, how far behind you are, and gives you the one command that updates it.

## Summary

| Slice | What the user gets | Status | Depends on |
|-------|--------------------|--------|------------|
| 53-A  | A notice in the desktop app saying how old your copy is and how many updates it has missed, with a copy button for the update command | Not Started | — |

One slice: it proves and delivers the whole flow. The notice first appears after the **second** published update following the merge — the first one only starts the update history the app reads.

## Slices

<!-- REVIEW SURFACE — the human reads this and stops. No technical artefact named below. -->

### Slice 53-A — "A newer version is available" notice

- **User value:** you no longer have to remember to update the desktop app, or guess whether you are running an old copy.
- **How it works:**
  - The desktop app checks for a newer version when it opens, then once an hour.
  - When one exists, a slim notice appears at the top of the window: *"A newer version is available — your copy is 5 days old and 3 updates behind."*
  - The notice shows one command and a **Copy** button. Paste it into any PowerShell window; it downloads the new version, closes the app, installs it and reopens it.
  - **Dismiss** hides the notice until another, newer update is published.
  - The browser version never shows the notice.
  - If the check fails (offline, download site down), nothing appears — no error.
- **Scenarios (GWT):**

```
Scenario: Behind by several updates
  Given the desktop app was built 5 days ago
    And 3 newer updates have been published since
  When  the app opens
  Then  a notice says "your copy is 5 days old and 3 updates behind"
    And it shows the update command with a Copy button

Scenario: Up to date
  Given no update has been published since this copy was built
  When  the app opens
  Then  no notice appears

Scenario: Copy the command
  Given the notice is showing
  When  I press Copy
  Then  the update command is on my clipboard
    And the button briefly reads "Copied"

Scenario: Dismiss until the next update
  Given the notice is showing for 3 missed updates
  When  I dismiss it
  Then  it disappears and stays gone after restarting the app
  When  a 4th update is published
  Then  the notice appears again, saying 4 updates behind

Scenario: Update published while the app is open
  Given the app has been open for hours with no notice
  When  a newer update is published
  Then  the notice appears within about an hour, without restarting

Scenario: Check fails
  Given the update history cannot be downloaded
  When  the app opens
  Then  no notice appears and the app works as normal

Scenario: Browser
  Given I use the app in a web browser
  Then  the notice never appears
```

---

## Build notes _(implementation — skip when reviewing)_

### 53-A
- **Events/commands/projections/API/CDK:** none.
- **Update history:** `publish-desktop.yml` downloads the existing `releases.json` from the `desktop-latest` Release (missing → `[]`), appends `{ sha, builtAt }` (a commit already in the history keeps its first entry), keeps the newest 50, and uploads it with the installers. `builtAt` is the same ISO timestamp baked into that build as `VITE_BUILD_TIME`.
- **Update command:** the workflow also uploads `desktop/scripts/update.ps1` as a Release asset, so the copied command works from any PowerShell window with no checkout and no GitHub CLI: `$f="$env:TEMP\ainote-update.ps1"; irm https://github.com/simonkirkham/ai-note-taker/releases/download/desktop-latest/update.ps1 -OutFile $f; if ($?) { powershell -ExecutionPolicy Bypass -File $f }`. `update.ps1` reads the public release anonymously. The command text lives in `desktop/src/updateCommand.ts`; the shell copies it itself, so the page never chooses clipboard text.
- **Build time:** `VITE_BUILD_TIME` set in `publish-desktop.yml` and passed through `build-web.mjs`; read by `web/src/lib/buildInfo.ts`. Absent (dev/hand build) → no check.
- **Fetch:** main process (`desktop/src/updateCheck.ts`) fetches `releases.json` — renderer fetch would hit CORS on the release-asset redirect. Exposed via preload as `window.desktop.updates.getHistory(): Promise<ReleaseEntry[] | null>` (`null` on any failure, 15 s limit) and `copyUpdateCommand(): Promise<boolean>`; both answer only the app's own origin (`ipcOrigin.ts`).
- **Decision (pure, `web/src/lib/updateStatus.ts`):** `behind` = entries with `builtAt` strictly later than this build's; `ageDays` = whole days from this build's time to now; notice shows when `behind > 0` and the newest `builtAt` ≠ the dismissed marker. Clock and history passed in.
- **Dismiss:** `localStorage` key holding the newest `builtAt` at dismissal; wrapped in try/catch.
- **Polling:** on mount + every 60 min; only when `window.desktop` exists.
- **Tests:** vitest specs for `updateStatus` (each scenario) and the banner component (render, copy, dismiss, browser → nothing, failure → nothing); desktop unit spec for history parsing (malformed JSON → `null`).
- **Acceptance criteria:**
  - [ ] Notice shows age + count behind when newer updates exist
  - [ ] No notice when up to date, on failure, or in a browser
  - [ ] Copy puts the command on the clipboard
  - [ ] Dismiss persists until a newer update is published
  - [ ] Re-checks hourly without a restart
  - [ ] Publish workflow appends to and uploads the update history + update script
- **Decisions:** one self-contained command instead of `npm run update`, because the app cannot know where the checkout lives. Full self-updating (the "desktop app auto-update" future feature) stays filed; this notice is the step before it.

### Observability
- Silent failure: the history fetch fails forever → no notice ever. Main process writes a `console.warn` with the reason on each failed fetch.
- Silent failure: the workflow stops appending → the app always reads "up to date". Verify after the second post-merge publish that `releases.json` holds ≥ 2 entries.

### Deploy-time
- Neutral for `deploy.yml`. `publish-desktop.yml` gains two small download/upload steps (seconds, recurring, runs after deploy).
