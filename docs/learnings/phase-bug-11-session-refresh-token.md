# BUG-11 — Session refresh-token flow (signed out too often)

**Slice:** BUG-11 · PR #175 · squash `0b05575` · deployed 2026-06-05 (deploy #469)

**One-liner:** Replaced the hidden-iframe `prompt=none` silent refresh — which third-party-cookie blocking breaks, signing users out ~hourly — with a backend refresh-token flow (httpOnly cookie + `/auth/refresh`).

## The non-obvious why

| Thing | Why it matters |
|-------|----------------|
| Iframe `prompt=none` refresh is structurally doomed | It needs Google's session cookie readable in a **third-party iframe**. Safari ITP, Firefox ETP, and Chrome's third-party-cookie phase-out block exactly that. So the refresh fails for a growing majority of browsers — not flaky, *deterministically broken*. Any "silent refresh via hidden iframe" design has this fate; reach for a backend refresh token instead. |
| The backend already held the fix ingredient | `/auth/token` does the code exchange with the `client_secret`. That is the one place a Google `refresh_token` can be obtained — the old code just discarded it. The fix was mostly "stop throwing the refresh token away." |
| Cookie `Path` is the **browser-visible** path, not the origin path | A CloudFront function strips `/api` before the origin (`NoteTakerStack.cs` `ApiStripFunction`): browser calls `/api/auth/refresh`, Lambda sees `/auth/refresh`. The cookie must be `Path=/api/auth` (what the browser sees) or it is never sent back. Easy to set `/auth` and have it silently never attach. |
| No CDK change needed — but only because of an existing choice | The `/api/*` behaviour already uses `CACHING_DISABLED` + `ALL_VIEWER_EXCEPT_HOST_HEADER`, which forward `Cookie`/`Set-Cookie` both ways. A cached or header-stripped behaviour would have silently eaten the cookie. |
| Re-issue the cookie on **every** refresh, not just on rotation (Hawk #1) | Google usually omits a rotated `refresh_token` on `grant_type=refresh_token`. If you only re-set the cookie when one is returned, the original `MaxAge=30d` never slides → an active session is still force-logged-out at 30 days. A milder repeat of the very bug being fixed. Slide the window each refresh. |

## Decisions

- **Storage = httpOnly cookie (not server-side store).** Single-user app; httpOnly + Secure + SameSite=Strict is a solid posture and needs zero new infra. Server-side store (Dynamo + session id) was rejected as over-engineered. The `/auth/refresh` contract doesn't change if we graduate later.
- **`prompt=consent` on the auth URL.** `access_type=offline` alone returns a refresh token only on first authorization; `prompt=consent` guarantees one for already-authorized users, at the cost of showing the consent screen each sign-in. Acceptable trade for reliability here.
- **Testability seam `IGoogleOAuthClient`.** The old static `HttpClient` made success paths untestable (only guard paths had tests). A DI typed-client + fake unlocked cookie-attribute and refresh-success/failure assertions.

## Test hygiene

- Auth tests toggle process-wide `GOOGLE_CLIENT_ID/SECRET` (the 503 guard test). Grouped `AuthTokenExchangeTests` + `AuthRefreshTests` in a `[CollectionDefinition(DisableParallelization = true)]` collection so the mutation can't leak into a concurrent auth test — the exact failure the CLAUDE.md env-var guardrail calls out.

## Process miss (actioned)

- **Merged while an unrelated deploy (#468) was in-progress** — a breach of the "never merge during a running deploy" gate. Cause: the merge command was chained after the gate-check `echo` in one shell, so it ran unconditionally instead of gating on the deploy-status result. Rendered harmless only because `deploy.yml` has `concurrency: group: deploy, cancel-in-progress: false`, which serialized #469 behind #468.
- **Fix:** the merge step must parse the `gh run list ... --json status,conclusion` result and abort if not `completed`/`success`; never run `gh pr merge` in the same unconditional command sequence as the gate check. Captured in `_minor-log.md` for the run-pipeline merge step.
