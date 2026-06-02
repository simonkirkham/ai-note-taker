# Learnings — Calendar refresh-token self-heal (PRs #90, #91, follow-up)

Operational + code learnings from a production calendar outage: the Google refresh token in
SSM had expired, and the path from "calendar is broken" to "fixed" surfaced several traps.

## The code change was never the fix — the token was

PR #91 made the failure *recoverable and observable*; it did not fix the outage. The outage
was a dead refresh token in SSM. These are two separate jobs, and conflating them wastes time:

- **Make it observable / recoverable** (code): distinct `invalid_grant` logging + self-heal.
- **Fix the root cause** (ops): re-mint the token and write it to the correct SSM parameter.

The self-heal still earns its place — it absorbs the *next* token rotation with no redeploy.

## Self-heal pattern: reload-once-and-retry on `invalid_grant`

`GoogleCalendarClient` caches the refresh token in a static field with no TTL (it survives
SnapStart warm invocations). That cache means a freshly-stored SSM token is invisible to a warm
instance. The fix is a bounded retry around the Google call:

1. On `TokenResponseException` where `ex.Error?.Error == "invalid_grant"`, force-reload the
   token from SSM (bypassing the cache) and retry **exactly once**.
2. If SSM returns the *same* token (`reloaded == refreshToken`), short-circuit to
   `calendar_unavailable` immediately — replaying a guaranteed-dead token is pointless.

This turns "must redeploy to recover" into "update SSM and the next call self-heals". The
single-retry invariant is enforced by `for (attempt = 1; attempt <= 2; ...)` plus an
`attempt == 1` guard on the reload branch.

## Google OAuth: publishing to production does NOT revive an expired token

Setting the consent screen to *In production* only stops *future* tokens from hitting the
7-day Testing expiry. A token minted while the screen was in *Testing* is already dead and
stays dead — you must mint a brand-new one **after** publishing. This was the single most
confusing point in the incident.

## The re-mint `put-parameter` is the error-prone step — automate it

Three independent ways the manual store silently fails, all hit during the incident:

1. **Missing `--overwrite`** → `ParameterAlreadyExists`, nothing changes.
2. **Wrong `--profile`** → updates the default/test account, not prod.
3. **Wrong `--region`** → the `prod`/`test` CLI profiles default to **eu-west-1**, but the app
   runs in **eu-west-2**; the write lands in the wrong region.

The symptom is identical in all three: "I updated it but the version/date didn't change."
Mitigation: the re-mint script now writes to SSM itself (`WRITE_SSM=1`, honouring
`AWS_PROFILE`/`AWS_REGION`, always `--overwrite`), and the guide tells you to **verify the
version bumped** with `describe-parameters` rather than trusting the command succeeded.

## Debugging discipline: anchor every log line to the change timeline

A stack trace showed the *old* generic `"Google Calendar API call failed"` message and nearly
led to a wrong conclusion ("prod is running old code"). Checking its timestamp (09:59 UTC)
against the prod deploy (10:09 UTC) showed it *predated* the fix. Always compare a log line's
timestamp to the deploy/config-change time before concluding which code produced it.

## The distinct-cause logging paid for itself

The earlier `calendar_unavailable` cause-logging (PR #90) plus #91's `invalid_grant`-specific
message are what made the root cause legible in CloudWatch. Generic catch-all logging would
have left the dead-token cause indistinguishable from a transient API error.
