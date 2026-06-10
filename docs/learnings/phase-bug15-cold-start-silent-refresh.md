# BUG-15 — Cold-start silent refresh

**Slice:** BUG-15 (defect). PR #209, squash `05d927a`, deployed 2026-06-10 (deploy #500). Frontend-only.

**Fix in one line:** on a cold load with no usable in-memory token, attempt `/api/auth/refresh` against the `rt` cookie before falling back to the sign-in gate.

## Lessons worth keeping

### 1. A new recovery mechanism is only as good as the entry paths that call it

| | |
|---|---|
| What happened | BUG-11 added the backend refresh-token flow + `attemptSilentRefresh()`. It worked — but **every** caller (refresh timer, tab-visibility recheck, 401-retry) was guarded on an *already-present* token. The most common return path, a cold load after the ~1h ID-token expiry, had no token, so none of them fired. The 30-day cookie was never used; the session effectively lasted ~1h. |
| Why non-obvious | The mechanism's own unit tests were all green — they seeded a token first. The gap was in the *consumers*, not the mechanism. "Engine built, ignition never wired." |
| Rule | When you add a session/state-recovery mechanism, enumerate **every** entry path that should consume it — especially cold start / first render — and add a test that starts from the empty state, not a seeded one. |

### 2. CI typechecks tests with a separate tsconfig — `tsc --noEmit` alone misses it

| | |
|---|---|
| What happened | Adding `authLoading` to the `AuthState` interface passed local `tsc --noEmit` (app `tsconfig`) and `eslint`, but CI's **`tsc -p tsconfig.test.json`** failed: `SignInPage.test.tsx` builds an `AuthState` object literal that was now missing the field. First green-looking push, red CI in 34s. |
| Rule | When widening a shared type/interface, run `tsc -p tsconfig.test.json` locally (not just the app typecheck) **and** grep tests for object-literal constructions of that type. The default `tsc --noEmit` does not cover the test sources. |

### 3. (Reinforced) npm install on Node 24 rewrites `package-lock.json` for Node-20 CI

`npm --prefix web install` in the worktree (local Node 24) rewrote `package-lock.json`, dropping optional native-binding entries Node-20 `npm ci` expects. No packages were added, so the lock change was pure drift — reverted with `git checkout -- web/package-lock.json` before commit. Matches the existing CLAUDE.md guardrail; cost nothing here because it was caught in the pre-push diff review.

## Notes

- The loading gate (`authLoading` checked before `!idToken`) is what prevents both a sign-in flash *and* a premature child data-fetch — it preserves the BUG-1 "token set before first fetch" invariant for free, because `AppContent` doesn't render while loading.
- Follow-up logged: **BUG-16** — `prompt=consent` (added by BUG-11 to guarantee a refresh token) forces a fresh consent grant on every sign-in, which is why Google emails the user each login. Independent change to the auth-URL builder; queued.
