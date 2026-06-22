# Desktop manual verification (Windows)

The automated `npm run test:e2e` proves the shell launches and renders the bundled
frontend. The items below need **real Google OAuth + a real Windows machine** and
cannot run in CI — verify by hand on Windows before marking a slice Done.

## 31-A — shell + in-window sign-in

**One-time setup (external):**
1. In Google Cloud Console → the existing OAuth **Web** client, add `http://localhost:5180` to **Authorized JavaScript origins** *and* **Authorized redirect URIs** (the app serves itself on `http://localhost:5180`; `redirect_uri = window.location.origin`).
2. Build with the client id baked in: `VITE_GOOGLE_CLIENT_ID=<id> npm run build`, then `npm start`.

**Verified 2026-06-22 on Windows** (build SHA `c44a6e3`, client `175601380067-sck0…`).

| # | Given / When / Then | Pass? |
|---|---------------------|-------|
| 1 | Given a first launch, When I click **Sign in with Google**, Then the Google consent/sign-in completes **inside the app window** (no external browser hand-off) and my notes list loads from the **prod API**. | ✅ 2026-06-22 |
| 2 | Given I am signed in, When I **quit and relaunch** the app, Then I am still signed in — no re-consent (the `rt` refresh-token cookie persisted in the Electron session). | ✅ 2026-06-22 |
| 2a | **Cookie mechanism (load-bearing):** after sign-in, confirm the `rt` cookie is actually **stored and replayed** — the `Secure` cookie must survive on `http://localhost`. If sign-in works but step 2 fails, this is the cause (DevTools → Application → Cookies → `http://localhost:5180`). | ✅ proven by #2 |
| 2b | **Sign-in redirects stay on localhost:** during sign-in, if the window ever lands on `https://note-taker-ai.com/...` instead of returning to `http://localhost:5180`, an `/api` redirect wasn't rewritten — note the URL. | ✅ stayed on localhost |
| 3 | Given the app is running, When I check the loaded notes, Then they are my real prod notes (confirms the bundle calls the live prod API, not a stub). | ✅ 2026-06-22 |
| 4 | Given CloudFront is unreachable (e.g. block its host), When I launch, Then the shell **still renders** (assets are local) — only live API calls fail. | ☐ not yet tested |

Record the build SHA shown on launch (31-A AC: stamp the bundled commit) next to the result.

## 31-B — deterministic system-audio grant

`pickDisplayMediaResponse` (primary-screen selection + `audio:'loopback'`) is unit-tested headlessly in `tests/displayMedia.spec.ts`. The grant only *fires* against a real display + audio stack on Windows, so verify by hand. **Re-run #1–#2 after any `electron` upgrade** — that is the whole point of 31-B (the implicit Electron default could regress; the explicit handler should not).

| # | Given / When / Then | Pass? |
|---|---------------------|-------|
| 1 | **Silent-mic system-audio:** Given another app is playing audio (a video/call) and I do **not** speak, When I record ~15 s, Then the transcript reflects the **system** audio (not empty). | ☐ |
| 2 | **No picker, no consent:** Given I click record, Then capture starts immediately — **no** screen-source picker dialog and **no** per-meeting consent prompt. | ☐ |
| 3 | **Deterministic-grant log:** Given the app console (terminal running `npm start`), When I record, Then it logs `[desktop] display-media granted: screen <id> + loopback audio` — proving the *explicit* handler fired, not the Electron default. | ☐ |
| 4 | **Mic+system mix unchanged:** Given I both speak and play system audio, When I record, Then both are transcribed (mix path identical to the web app). | ☐ |

## 31-C — packaged Windows installer

The electron-builder config is asserted headlessly in `tests/packaging.spec.ts`. Producing
the `.exe` needs Windows (`electron-builder --win` uses Wine on Linux), so build + install by hand.

```powershell
npm install ; npm --prefix ../web install   # one-time
npm run package                              # → release/AI Note Taker Setup <version>.exe
```

| # | Given / When / Then | Pass? |
|---|---------------------|-------|
| 1 | **Installer is produced:** Given `npm run package` on Windows, Then `release/AI Note Taker Setup <version>.exe` is created (no signing). | ☐ |
| 2 | **Clean install launches:** Given a machine without the app, When I run the `.exe`, Then it installs (one-click, no admin), adds a Start-menu/desktop shortcut, and the window opens rendering the **bundled** frontend. | ☐ |
| 3 | **Sign-in works post-install:** Given the installed app (no env var, no dev server), When I sign in with Google, Then it completes in-window and my prod notes load (client id baked into the bundle). | ☐ |
| 4 | **Records with one-time OS grant:** Given the installed app, When I record, Then system + mic audio are captured with no per-meeting picker/consent (one-time OS grant only). | ☐ |
| 5 | **Relaunch from Start menu:** Given I closed the app, When I launch it from the Start-menu shortcut, Then it opens and I am still signed in (no rebuild, no terminal). | ☐ |

## Troubleshooting

- **`Error 400: redirect_uri_mismatch` immediately after adding `http://localhost:5180`** — the value is correct (`redirect_uri = window.location.origin = http://localhost:5180`: no trailing slash, `localhost` not `127.0.0.1`, port `5180`, `http` not `https`). The cause is **Google propagation lag** — a freshly added+saved redirect URI is not live immediately; it can take **~5 min to a few hours**. Confirm the running app's `window.location.origin` (DevTools console) reads exactly `http://localhost:5180`, then wait and retry. **No code change.** Hit and confirmed 2026-06-22: config was right on the first attempt; the URI simply had not propagated.
