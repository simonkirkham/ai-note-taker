# Phase Bugs — Defect backlog

**Goal:** A standing, unnumbered phase that captures bugs found in the deployed app and tracks them to a fix. Unlike numbered phases, this has no learning theme and no fixed slice sequence — items are added as defects surface and removed (marked Done) as they are fixed. Each bug is still fixed the normal way: a failing spec/test that reproduces it first, then the fix.

**What belongs here:** defects — behaviour that is wrong, broken, or crashes. If it's a small adjustment to working behaviour it's a **minor change** ([docs/phases/phase-minor-changes.md](phase-minor-changes.md)); a new capability is a **feature** ([docs/future-features.md](../future-features.md) → a numbered phase); a refactor/upgrade/CI item is a **technical improvement** ([docs/technical-improvements.md](../technical-improvements.md)).

**Learning surface:** none specific — this is maintenance work. The discipline is reproduce-before-fix (the Prove-It pattern) and guarding against regression.

---

## Bug list

```
BUG-1  Blank screen presented when 401 returned from API ──────── open
```

Further bugs will be appended as they are identified.

---

## BUG-1 — Blank screen presented when 401 returned from API

**Status:** Open

**Severity:** High — the app is unusable when it occurs; the user sees an empty/broken screen with no way to recover other than a manual reload.

**Symptom:** When API calls return `401 Unauthorized`, the screen is presented blank (or in a broken half-rendered state) instead of either silently refreshing the token or routing the user to sign in. Observed on the home screen: `today`, `todos`, `tags`, `notes`, `folders`, and `cards` all return `401` while the calendar widget shows "Cannot connect to calendar / Retry". The page chrome renders but the data regions are empty because every data fetch failed unauthenticated.

**Evidence:** DevTools Network panel showing `401` on `/today?tz=Europe%2FLondon`, `/todos`, `/tags`, `/notes`, `/folders`, `/cards` (all `fetch`, initiator `index-*.js`), home screen rendered with empty meetings/todo regions.

**Suspected cause (to confirm):** The token has expired (or was never attached) and the 401 path does not trigger a silent refresh or a redirect to sign-in — the fetches just fail and their consumers render nothing. Phase 11 added token expiry + silent refresh and a `visibilitychange` pre-flight guard; this case appears to slip past that path (e.g. expiry detected only on tab-wake, not on a cold load where the stored token is already stale; or the 401 handler does not fire because the request carried no token). See memory `feedback_react_effect_ordering` (initial API calls can fire before `AuthProvider` sets the token) and Phase 11's 401-on-wake slice.

**Expected behaviour:** A 401 from any API call should trigger a single silent token refresh and retry; if refresh fails (or there is no valid session), route the user to the sign-in flow. The user must never be left on a blank/half-rendered screen.

**Repro (to be confirmed during fix):**
1. Sign in, then let the access token expire (or clear/expire the stored token).
2. Cold-load the home screen.
3. Observe all data fetches return 401 and the screen renders empty instead of refreshing or redirecting.

**Acceptance criteria:**
- A 401 response from any data fetch triggers a silent refresh-and-retry exactly once.
- If refresh fails or no session exists, the user is routed to sign-in — never left on a blank screen.
- A failing test reproduces the blank-screen-on-401 condition before the fix lands, and passes after.

**Key files (to be confirmed):** frontend API client / fetch wrapper and `AuthProvider` in `web/src/`.
