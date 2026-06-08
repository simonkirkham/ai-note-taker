# Phase 21-C — Deep-link edge cases (completes Phase 21)

**Slice:** 21-C · **PR:** #192 · **Deploy:** #483 · **Date:** 2026-06-08

Final routing slice: a dead note link recovers, and a deep link survives sign-in. Two learnings.

## 1. A deep link can't survive OAuth in memory — stash and restore

`signIn()` does a full-page redirect to Google with `redirect_uri = window.location.origin` (the root). Google redirects back to `/?code=...`, and the callback strips to `/`. So the originally requested path (`/notes/abc`) is **physically gone** by the time the app re-renders — there is no in-memory URL to "preserve" (the plan's original wording).

**Pattern:** `signIn()` writes `window.location.pathname + search` to `sessionStorage.postLoginRedirect` (skipping `/`); once `idToken` is set, an effect in `AppGate` (inside the Router) reads it, `removeItem`s it (one-shot), and `navigate(dest, { replace: true })`. Notes:
- The restore effect must live **inside** `<BrowserRouter>` to use `navigate`; `AuthContext` (outside the router) can only stash, not restore.
- Place the effect **before** AppGate's early returns (`!idToken` etc.) or it violates rules-of-hooks.
- `dest` is same-origin browser-derived, never user input → no open-redirect. Clear before navigate so a later sign-out/sign-in can't replay a stale destination.

## 2. RUM custom events are a guarded no-op locally

The CloudWatch RUM client (`cwr` global) is injected by the `index.html` rum-snippet only in deployed environments. `src/rum.ts` wraps it: `(window as unknown as { cwr? }).cwr?.("recordEvent", type, data)` — absent locally/in tests, so it's a safe no-op. The missing-note path emits the event **`deadNoteLink`** `{ noteId }` — **a future CloudWatch RUM dashboard/alarm must query that exact string.**

## Minor

- **NoteView gained an optional `onNotFound`.** On a 404 it calls the handler if present (NoteRoute → redirect + toast), else falls back to the existing in-place "Note not found" view — so the component stays usable without a router parent.
- **Hard-load coverage is E2E, not unit.** `DeepLinkJourney` captures the created note's URL, then does a fresh `GotoUrlAsync` to prove the CloudFront SPA rewrite serves `/notes/:id` on a cold load (re-injecting the E2E auth token before navigation). A missing-id hard-load asserts recovery to home. Runs post-deploy only (`FRONTEND_URL`).
- **Phase 21 done:** `/`, `/folders/:folderId` (+ `unfiled`, any depth), `/notes/:noteId`; back/forward, deep-links, shareable URLs, and graceful recovery all work. React Router v7 via the `react-router` package; transient surfaces (sidebar, preview, note tabs) intentionally unrouted.
