# ADR 0013 — Adopt react-router-dom for client-side routing

**Status:** Accepted (Phase 21, slice 21-A, 2026-06-08)

## Context

The `web/` frontend has **no router**. `App.tsx` holds a single in-memory `view` union (`list` | `folder` | `note`); opening a note is `setView({ kind: "note", noteId })`. Consequences:

- The browser URL never changes — **back/forward do nothing**.
- A note or folder **cannot be linked, bookmarked, or reloaded** to where you were.
- A shared/reloaded deep link always lands on the home screen.

This blocks the Phase 21 user requirement: distinct URLs, working history navigation, and shareable note/folder links.

[ADR 0010](0010-server-state-strategy.md) deliberately kept **server state** hand-rolled to preserve the learning value of the fetch/cache mechanics. Routing is a different concern: the history/URL ↔ view mapping, focus/scroll restoration, and nested-route matching are not mechanics this project gains from re-implementing, and a hand-rolled History-API router would carry real correctness risk (popstate edge cases, double-render, scroll restoration) for no learning upside.

## Decision

Adopt **React Router v7** as the client-side router, importing from the **`react-router`** package.

- In v7 the packages merged: `BrowserRouter`, `Routes`, `Route`, `Navigate`, and the hooks are all exported from `react-router`. We depend on and import from `react-router` directly, not the legacy `react-router-dom` alias — its CJS shim `require()`s an `.mjs` file, which the Vitest `vmThreads` pool (used locally per `vite.config.ts`) cannot load. `react-router`'s CJS entry has no such require, so tests run with no config workaround.
- Surfaces routed in Phase 21: home (`/`), folders (`/folders/:folderId`, `/folders/unfiled`), notes (`/notes/:noteId`).
- `<BrowserRouter>` is mounted **inside `App`** (wrapping the auth short-circuit) so the existing component tree — and every test that renders `<App />` — keeps working without a separate router wrapper.
- Transient overlays (folder sidebar, folder-preview pull-out, note Transcript/Quick/Final tabs) stay in component state — they are not destinations and get no URL.

## Alternatives considered

| Option | Why not |
|--------|---------|
| **Hand-rolled History API** (`pushState` + `popstate`) | No dependency, but re-implements focus/scroll/popstate correctness the library gets right; the learning upside is low and the regression risk is real. |
| **wouter** (~2KB) | Smaller, but react-router is the ecosystem default, already understood, and v7 covers deep-linking/nested routes with no extra plumbing; bundle delta is immaterial here. |
| **TanStack Router** | Type-safe routing is attractive but overlaps with the in-flight Phase 20 TanStack Query migration's learning load; defer. |

## Consequences

- One new dependency (`react-router` ^7). Installed on **Node 20** to match CI (the npm-version lock-file guardrail).
- CloudFront already rewrites unknown paths to `index.html` (`CloudFront_HasTwoFunctions_SpaRoutingAndApiStrip`), so deep-linked hard loads serve the SPA with **no infra change**.
- Navigation moves from `setView(...)` to `useNavigate()`/`<Routes>`/`useParams`; the `view` union is removed over slices 21-A (note arm) and 21-B (folder arm).
- The auth gate must preserve the requested URL across sign-in (handled in 21-C).
- Reversible: routing is isolated to `App` and the navigation handlers; reverting means restoring the `view` union. No data or event-model impact.
