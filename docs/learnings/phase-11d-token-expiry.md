# Slice 11-D — Token expiry and silent refresh

**Status:** Done  
**Merged:** 2026-05-20  
**PR:** #76

---

## What was built

Silent token refresh for Google ID tokens (1-hour expiry). On sign-in a `setTimeout` fires 5 minutes before the token's `exp` claim; on fire an iframe attempts a `prompt=none` PKCE refresh. Success swaps the token and reschedules. Failure (third-party cookies blocked, session ended) shows a non-dismissable `SessionExpiredBanner`. Any 401 from the API also triggers the banner as a safety net.

New files: `silentRefresh.ts`, `useGoogleAuth.ts`, `SessionExpiredBanner.tsx`, `public/silent-refresh.html`.  
Modified: `AuthContext.tsx` (adds `sessionExpired`), `App.tsx` (renders banner before sign-in guard).

---

## Learnings

### 1. `findByRole` hangs when `vi.useFakeTimers()` is active

`findByRole` polls with `setTimeout` internally. When fake timers are enabled, those poll callbacks never fire automatically — the test times out waiting for an element that has already rendered.

**Fix:** After `await act(() => vi.advanceTimersByTimeAsync(...))`, all async timer work and React state flushes are settled. Switch to synchronous `screen.getByRole()` / `screen.queryByRole()` at that point — they read the DOM as it is now, without polling.

```typescript
// Wrong — hangs with fake timers
await act(() => vi.advanceTimersByTimeAsync(60 * 60 * 1000))
expect(await screen.findByRole('button', { name: /sign in again/i })).toBeInTheDocument()

// Correct — synchronous after act()
await act(() => vi.advanceTimersByTimeAsync(60 * 60 * 1000))
expect(screen.getByRole('button', { name: /sign in again/i })).toBeInTheDocument()
```

**Applies to:** any test that uses fake timers and waits for a DOM change caused by a timer-triggered state update.

---

### 2. Token factory must be called at the fake clock's current time

When writing timer-based tests, token expiry is calculated relative to `Date.now()`. With fake timers, `Date.now()` reflects the advanced time. If you create the "new token" before advancing the clock, it expires relative to the start time — not the refresh point — so the computed delay is 0 and `onRefreshFailure` fires immediately instead of rescheduling.

**Fix:** Use `mockImplementation` so the token is created at call time (after the clock has advanced):

```typescript
// Wrong — newToken has exp relative to T+0
const newToken = makeToken(65)
vi.mocked(attemptSilentRefresh).mockResolvedValueOnce(newToken)

// Correct — token is created when the timer fires (at T+60min)
vi.mocked(attemptSilentRefresh).mockImplementation(async () => makeToken(65))
```

---

### 3. Double-scheduling when a timer success callback sets state that triggers a scheduler useEffect

If the timer callback calls `onRefreshSuccess(token)`, which calls `setIdToken(token)`, and `AuthContext` has a `useEffect([idToken])` that calls `scheduleRefresh` — then calling `scheduleRefreshRef.current?.(newExp)` *before* `onRefreshSuccess` schedules twice per cycle. The second call cancels the first (no correctness bug), but it's confusing and wasteful.

**Fix:** Let the `useEffect` be the single scheduling path. Remove the explicit recursive call from the timer callback; it is redundant.

---

### 4. `new Promise` executors that call `.then()` without `.catch()` leave the promise unsettled on rejection

`generateCodeChallenge(verifier).then(challenge => { ... })` inside a `new Promise` executor: if `generateCodeChallenge` rejects (e.g., `crypto.subtle` unavailable), the rejection escapes the executor and the outer promise never resolves or rejects. The 15-second timeout fires eventually, but the silent hang is hard to diagnose in production.

**Fix:** Always chain `.catch(() => resolve(null))` onto any thenable called inside a `new Promise` executor:

```typescript
generateCodeChallenge(verifier)
  .then((challenge) => { /* ... */ })
  .catch(() => resolve(null))
```

---

### 5. Non-dismissable overlays need `role="dialog"` + `aria-modal`

A full-screen blocking overlay without ARIA markup is invisible to screen readers. The correct pattern:

```tsx
<div
  role="dialog"
  aria-modal="true"
  aria-labelledby="session-expired-heading"
>
  <p id="session-expired-heading">Your session has expired.</p>
  <button onClick={onSignIn}>Sign in again</button>
</div>
```

---

### 6. Fake-timer tests per describe block, not global

Using `vi.useFakeTimers()` in `beforeEach` at file scope affects all tests, including those that depend on real async I/O (e.g., MSW network mocks). The 401 test hung because fake timers were active and `findByRole`'s retry loop used `setTimeout`.

**Fix:** Scope fake timer setup to the describe blocks that actually need it, and leave 401/network tests with real timers:

```typescript
describe('timer-based tests', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())
  // ...
})

describe('401 response', () => {
  // no fake timers — MSW responses are real async
})
```

---

## Process improvements applied

- **Done:** Added the fake-timer / synchronous-query pattern to the test file as comments.
- **Done:** Scoped fake timer setup per describe block (not global) in `TokenRefresh.test.tsx`.
- **TODO (human):** Add a note to the project test guidelines (or `src/test/setup.ts` header) stating: "When using `vi.useFakeTimers()`, always use synchronous RTL queries after `act(advanceTimers)` — `findByRole` will timeout."
