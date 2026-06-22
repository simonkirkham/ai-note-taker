# 31-A manual verification (Windows)

The automated `npm run test:e2e` proves the shell launches and renders the bundled
frontend. The items below need **real Google OAuth + a real Windows machine** and
cannot run in CI — verify by hand on Windows before marking 31-A Done.

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

## Troubleshooting

- **`Error 400: redirect_uri_mismatch` immediately after adding `http://localhost:5180`** — the value is correct (`redirect_uri = window.location.origin = http://localhost:5180`: no trailing slash, `localhost` not `127.0.0.1`, port `5180`, `http` not `https`). The cause is **Google propagation lag** — a freshly added+saved redirect URI is not live immediately; it can take **~5 min to a few hours**. Confirm the running app's `window.location.origin` (DevTools console) reads exactly `http://localhost:5180`, then wait and retry. **No code change.** Hit and confirmed 2026-06-22: config was right on the first attempt; the URI simply had not propagated.
