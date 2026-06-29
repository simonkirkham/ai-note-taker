# BUG-16 — Conditional Google consent prompt

**Slice:** BUG-16 (defect). PR #215, squash `0ecdb81`, deployed 2026-06-10 (deploy #504). Frontend-only (+ one backend regression test).

**Fix in one line:** force `prompt=consent` only when the client has no refresh token on file (a localStorage flag), so a returning user re-authenticates silently and Google stops emailing them on every login.

## Lessons worth keeping

### 1. Google ties "issue a refresh token" and "send the consent email" to the same lever

| | |
|---|---|
| The coupling | Under `access_type=offline`, Google returns a `refresh_token` **only** on a consent grant — i.e. the first authorisation, or any auth with `prompt=consent`. A consent grant is also exactly what triggers Google's "info you shared" email. So "stop emailing the user" and "guarantee we get a refresh token" pull in opposite directions. |
| The naive trap | Dropping `prompt=consent` outright (the obvious fix) stops the email but means a returning user whose cookie is gone re-auths, Google sees an existing grant, returns **no** refresh token, and — because this app stores the token only in the `rt` cookie, not server-side — the session silently degrades to ~1h. |
| The resolution | Force consent **exactly and only when no refresh token is on file**, tracked by a browser-local flag (`google_refresh_established`). Email fires only when a new token is genuinely needed (first auth / token gone), which is unavoidable without server-side token storage. The user picked this over server-side persistence (bigger slice) for a Low-severity bug. |

### 2. A "token gone" flag must be cleared on EVERY refresh-failure path — including the one that bypasses the obvious handler

| | |
|---|---|
| What happened | The flag was cleared on three failure paths (scheduled timer, tab-visibility, cold-start bootstrap) via `handleRefreshFailure`/the cold-start effect — but **not** on the api-layer 401 path, which goes `apiFetch` 401 → `setOnRefresh` → `attemptSilentRefresh` null → `triggerUnauthorized`, never touching `handleRefreshFailure`. Hawk caught it. |
| The consequence | A fetch-driven 401 racing ahead of the timers left the flag set → next sign-in omitted `prompt=consent` → no new refresh token → ~1h session loop that does **not** self-heal (the OAuth return takes the exchange path, which re-marks the flag). |
| Rule | When a piece of state means "the thing is gone," enumerate every code path that detects "gone" and clear it in all of them. Here there were four refresh-failure paths through two different handlers; the unit tests were green because none exercised the fourth. Add a test per path. |

### 3. (Process) The recurring `TagsJourney` E2E flake gated this merge three times

The change-independent `TagsJourney.RemoveTag_*` flake ([technical-improvements.md](../technical-improvements.md)) failed main deploys #502/#503/#504 on 2026-06-10; BUG-16 was approved and green on its own gates but had to wait out two parallel-merge reruns plus its own. "Single rerun clears it" keeps hiding the cost; it now routinely delays unrelated merges. The fix is the add-add-then-remove reproduction test, not more reruns.

## Notes

- No backend change was needed for token retention: `/auth/token` already sets the `rt` cookie only when Google returns a non-empty `refresh_token` (`AuthEndpoints.cs:30`), so a `prompt`-less re-auth that returns no token never clobbers an existing cookie. Locked with a regression test.
- localStorage flag helpers fail-safe to "not established" (force consent) if storage throws — the safe direction: a needless consent prompt, never a broken session.
- `signOut` deliberately leaves both the flag and the `rt` cookie, so a returning user re-auths silently off the existing cookie; if the cookie is actually dead, the 401/refresh-failure clear self-heals on the next cycle.
