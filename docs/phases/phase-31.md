# Phase 31 — Desktop app (no per-meeting audio-share consent)

**Goal:** Package the existing frontend as a **Windows desktop app** so capturing call/system audio no longer triggers the browser's per-meeting screen-share picker + consent. The whole trick is the Electron **main process** `session.setDisplayMediaRequestHandler`, which auto-answers each display-capture request with `{ video: <screen>, audio: 'loopback' }` — the renderer's existing `getDisplayMedia({audio,video})` call resolves with **no picker and no per-meeting consent**, just a one-time OS-level grant per machine. Proven on Windows by the 2026-06-03 spike (see Reference below).

## Summary

| Slice | Summary | Status | Depends on |
|-------|---------|--------|------------|
| 31-A | Electron shell loads the **bundled** frontend and completes Google sign-in end-to-end against the prod API (de-risks OAuth-in-Electron; recording still uses the normal picker) | Done | — |
| 31-B | Main-process `setDisplayMediaRequestHandler` auto-grants screen + loopback audio — record a meeting with **no picker, no per-meeting consent** (the core value) | Not Started | 31-A |
| 31-C | Package as an **unsigned Windows installer** via `electron-builder`; a clean install launches, signs in, and records with one-time OS grant | Not Started | 31-B |

**Ordering:** strictly 31-A → 31-B → 31-C. 31-A isolates the one genuine unknown (Google OAuth redirect/cookie behaviour inside an Electron `BrowserWindow`) before any audio work; it ships a working desktop client that behaves exactly like the web app (recording via the standard picker — no regression). 31-B removes the picker. 31-C makes it installable.

## Decisions (locked 2026-06-22)

| Decision | Choice | Why |
|----------|--------|-----|
| Shell | **Electron** | `setDisplayMediaRequestHandler` is Electron-specific; Tauri's system webview can't auto-grant display capture. |
| Platform | **Windows only** | The proven path (spike). macOS loopback via this handler is unproven and materially harder — deferred to a later phase, not this one. |
| Frontend source | **Bundle-shell** — ship the compiled `web/` assets inside the app, loaded from disk; call the **live prod API** | Shell always opens (no blank window on a network blip or mid-deploy); desktop client is version-pinned; the auto-capture grant applies to a reviewed local bundle, not a live remote origin; desktop-only code stays out of the public web build. Cost: re-package per frontend change. |
| Packaging | **Unsigned personal build** (`electron-builder`), no auto-update | Single-user/learning app; signing + an update feed are overkill. |

## Scope guardrails

- **Zero backend / CDK / event-model changes.** No new aggregate, command, event, or projection. Transcription credentials still come from the existing API endpoint; the PCM worklet and the mic+system mixing in `web/src/hooks/useTranscription.ts` are reused unchanged.
- **New top-level `desktop/` directory** for the Electron main/preload + build scripts. `web/` is consumed as a build input, not modified for desktop unless a slice's AC requires Electron feature-detection.
- **Deploy-time impact: neutral on the prod pipeline.** The desktop build is a separate, manually-triggered artifact — it does **not** run in `deploy.yml` and adds nothing to `cdk deploy`. (If a desktop CI job is added later, state its time delta then.)

---

## 31-A — Electron shell + bundled frontend + sign-in

**Capability:** Launch a Windows desktop window that loads the bundled frontend, completes Google sign-in, and shows the user's notes from the prod API — functionally identical to the web app, in a window.

**Design:**
- New `desktop/` Electron app: `main.ts`, `preload.ts` (contextIsolation on), and a build script that runs `vite build` in `web/` and copies the output to `desktop/web-dist`.
- **`http://localhost:<port>` loopback origin (NOT `loadFile`, NOT a custom scheme).** Two constraints fix this:
  1. The frontend calls **relative** `/api/*` (`web/src/api/client.ts` → `base = "/api"`); prod serves SPA + `/api/*` from **one origin** (`https://note-taker-ai.com`, confirmed `NoteTakerStack.cs:1297–1319`) with the httpOnly `rt` cookie scoped to it. A `file://` load makes `/api` resolve to `file:///api` (dead).
  2. `redirect_uri = window.location.origin` (`AuthContext.tsx:145,192`), and **Google OAuth (Web client) accepts `http://localhost`/`127.0.0.1` redirect URIs but rejects custom schemes** (`app://`) and non-https. Since the origin *is* the redirect URI and `web/` must not change, the origin must be Google-acceptable → **localhost**.
- So `main.ts` runs a tiny loopback server on `127.0.0.1:<fixed-port>`: serves `web-dist/` assets (SPA fallback to `index.html`) and **proxies `/api/*` → `https://note-taker-ai.com/api/*`** via Electron's `session.fetch` with the session cookie jar, so the httpOnly `rt` cookie round-trips and persists across restart (persistent session). `BrowserWindow` loads `http://localhost:<port>`. Renderer keeps relative `/api`, **no `web/` change**.
- **One-time external step:** register `http://localhost:<port>` as an Authorized redirect URI (and JS origin) on the existing Google OAuth Web client. Captured in `desktop/MANUAL-VERIFICATION.md`.
- **Why not absolute `base` or `app://`:** absolute `https://…/api` from a local page is cross-origin → CORS + SameSite-cookie breakage; `app://` is rejected by Google as a redirect URI. Loopback keeps it same-origin and Google-compatible.
- De-risking target: confirm Google sign-in completes in the localhost window and the `rt` cookie persists across an app restart.

**Scenarios (GWT):**
- Given the bundled desktop app When I launch it Then the frontend renders from local assets (no CloudFront fetch) and the notes list loads from the prod API.
- Given a first launch When I sign in with Google Then sign-in completes inside the Electron window and my notes appear.
- Given I signed in previously When I quit and relaunch Then I am still signed in (the `rt` cookie persisted) — no re-consent.

**Status:** Done (PR #311, deploy #611). Code-verifiable ACs met by `desktop/tests` (loopback serve + SPA fallback + `/api` proxy + path-traversal) and the e2e contextIsolation probe. The two real-OAuth-on-Windows ACs were **manually verified on Windows 2026-06-22** (build SHA `c44a6e3`) — sign-in completes in-window and the session survives a quit+relaunch; recorded in `desktop/MANUAL-VERIFICATION.md`.

**Acceptance criteria:**
- [x] Desktop window loads the frontend entirely from bundled assets (loopback server serves `web-dist/` with SPA fallback; no CloudFront fetch).
- [x] Google sign-in completes in-window; notes load from the prod API. _(manual, verified 2026-06-22 — `MANUAL-VERIFICATION.md`)_
- [x] Session survives an app restart (refresh-token cookie persisted in the Electron session). _(manual, verified 2026-06-22 — `MANUAL-VERIFICATION.md`)_
- [x] `contextIsolation: true`, `nodeIntegration: false`; renderer gets only what `preload` exposes.
- [x] No change to `web/` source beyond (if needed) an Electron feature-detect flag. _(zero `web/` change — slice is purely additive under `desktop/`)_

---

## 31-B — Auto-granted system-audio capture (no picker)

**Capability:** Start a meeting recording in the desktop app and capture mic + system audio with **no source-picker dialog and no per-meeting consent**.

> **Finding (2026-06-22, on Windows):** the 31-A shell **already** captures system audio with no picker/consent — `getDisplayMedia` resolves with a loopback audio track via **Electron 33's implicit default**, with **no** `setDisplayMediaRequestHandler` in our code (manually confirmed: silent-mic test produced a non-empty transcript from system audio). So 31-B is **no longer "make it work" — it is "lock it in."** We are currently depending on an undocumented Electron default that (a) could change/tighten on any `electron` upgrade → silent regression to mic-only (the renderer's `catch` at `useTranscription.ts:204` swallows the failure — no error, no prompt), (b) may not reproduce on a clean 31-C install, and (c) leaves the screen choice + `audio:'loopback'` implicit. 31-B makes the grant **explicit, deterministic, and guarded**.

**Design:**
- In `desktop/main.ts`, register `session.defaultSession.setDisplayMediaRequestHandler((request, callback) => callback({ video: <primary screen via desktopCapturer.getSources>, audio: 'loopback' }), { useSystemPicker: false })` — pin the behaviour rather than rely on the Electron default.
- Extract the source-selection logic into a pure, unit-testable function (e.g. `desktop/src/displayMedia.ts` → pick primary screen, return `{ video, audio: 'loopback' }`) so CI proves the selection without a real display.
- The renderer's existing `getDisplayMedia({audio:true, video:true})` call (in `useTranscription.ts`) resolves against the handler — spike-confirmed to need **no renderer change**. Video track is captured to satisfy the handler and discarded; only the loopback audio is mixed with the mic.
- **Guard (observability):** assert/log a non-empty loopback audio track on record start; surface if absent so a future Electron-default change can't silently degrade to mic-only. (Decide renderer-side vs main-process at slice design — keep `web/` change minimal per the phase guardrail.)
- Verify the existing mix → PCM worklet → AWS Transcribe streaming path is byte-for-byte the same as the web app.

**Scenarios (GWT):**
- Given the desktop app When I click record Then capture starts immediately with no screen-picker dialog and no per-meeting consent prompt.
- Given a meeting playing system audio When I record Then the live transcript reflects **system** audio (not just mic).
- Given mic + system both active When I record Then both streams are transcribed, exactly as in the web app.

**Acceptance criteria:**
- [ ] No source-picker dialog and no per-meeting consent on record.
- [ ] System (loopback) audio is captured and transcribed; mic+system mixing unchanged.
- [ ] One-time OS grant only (no per-meeting OS prompt).
- [ ] The Transcribe streaming path is unchanged from web (no new credentials/endpoint).

---

## 31-C — Package as an unsigned Windows installer

**Capability:** Produce an installable `.exe`; a clean install launches, signs in, and records a meeting with a one-time OS grant.

**Design:**
- `electron-builder` config targeting Windows (`nsis` or portable), unsigned, no auto-update.
- Bundle the `vite build` output as part of the packaging step so the installer is self-contained.
- Document the one-time OS grant the user accepts on first record.

**Scenarios (GWT):**
- Given the packaged installer When I install on a clean Windows machine and launch Then the app opens and the frontend renders from the bundle.
- Given a fresh install When I sign in and record Then audio capture works with the one-time OS grant and no per-meeting consent.

**Acceptance criteria:**
- [ ] `electron-builder` produces an installable Windows artifact from a documented command.
- [ ] Clean-install launch renders the bundled frontend and signs in.
- [ ] Recording works post-install with only the one-time OS grant.
- [ ] Build steps documented in `desktop/README.md`; not wired into the prod `deploy.yml`.

---

## Observability

Desktop-specific silent failure modes (no CloudWatch reach into the client — surface in-app/log to the renderer console at minimum):
- **Auto-grant misfires** → recording silently captures mic-only (system audio missing). Guard: assert a non-empty loopback track on record start; log/surface if absent.
- **Sign-in fails in-window** (redirect/cookie quirk) → blank or stuck auth. Guard: 31-A must verify cookie persistence explicitly, not just a one-session login.
- **Bundle drift** → desktop client runs a stale frontend against a changed API. Guard: stamp the bundled build's commit SHA in the app and log it on launch.

---

## Reference — 2026-06-03 Windows spike (de-risked)

Throwaway Electron spike on `prototype/desktop-audio-spike` (`desktop-spike/`, reference-only, never merged, branch since removed). With `setDisplayMediaRequestHandler` answering each request `{ video: <screen>, audio: 'loopback' }`, the renderer's `getDisplayMedia({audio,video})` resolved with **no source-picker dialog and no per-meeting consent**, and a live level meter tracked **system audio** (Windows loopback). The picker friction is genuinely removable via a desktop shell — remaining work is integration/packaging, not feasibility. macOS loopback via this handler remains **unproven** (the weak platform; out of scope for this phase).

**Highest-fidelity alternative (out of scope):** skip `getDisplayMedia` entirely and capture OS audio loopback natively (WASAPI on Windows) — zero consent and best quality, but platform-specific native code. Overkill for this phase.

**Raised in:** User request, 2026-06-03 — "Currently agreeing to share the audio from the machine for each meeting is far from ideal"; would an installed app make audio access easier? Graduated to this phase 2026-06-22.
