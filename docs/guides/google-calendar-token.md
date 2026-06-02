# Re-minting the Google Calendar refresh token

The Lambda reads Google Calendar on the user's behalf using a long-lived **refresh
token** stored in SSM Parameter Store at the path given by `GOOGLE_REFRESH_TOKEN_SSM_PATH`.
When that token dies, calendar reads fail and the UI shows "Cannot connect to calendar".

This guide explains why it dies and how to mint and install a new one.

## How to recognise the problem

In the Lambda's CloudWatch logs you'll see:

```
Google.Apis.Auth.OAuth2.Responses.TokenResponseException: Error:"invalid_grant",
Description:"Token has been expired or revoked."
```

and, with the self-healing handler in `GoogleCalendarClient`, one of these follow-ups:

- `Google rejected the calendar refresh token (invalid_grant: ...). The cached token is
  expired or revoked; reloading from SSM and retrying once.` — the Lambda noticed and
  re-read SSM. If you'd already stored a fresh token, the retry succeeds and the user
  never sees an error.
- `Calendar refresh token in SSM is unchanged and still invalid (invalid_grant) ... Re-mint
  the token` — SSM still holds the dead token. **This is your cue to run the steps below.**

## Why refresh tokens die

The short-lived **access token** (≈1 hour) is refreshed automatically on every call — you
never deal with that. The **refresh token** is the long-lived credential, and Google does
**not** auto-rotate it. It becomes invalid when:

1. **The OAuth consent screen is in "Testing" status** → refresh tokens expire after **7
   days**. This is the most common cause for this project. Fix: set the consent screen to
   **In production** (see below).
2. 6 months of inactivity (not a concern here — the Lambda uses it regularly).
3. The user revokes access at <https://myaccount.google.com/permissions>.
4. The Google account password changes (only affects sensitive scopes).
5. More than 50 refresh tokens were issued for the same client+user — the oldest is evicted
   (can happen if you re-mint repeatedly while debugging).

There is no way for the Lambda to renew the refresh token itself — a new one only comes from
a human completing the OAuth consent flow, which is what the re-mint script does.

## One-time prerequisites (in Google Cloud Console)

These only need doing once. Both live under your Google Cloud project at
<https://console.cloud.google.com/apis/credentials>.

1. **Publish the consent screen.** APIs & Services → **OAuth consent screen** → set
   **Publishing status** to **In production**. This removes the 7-day token expiry. For a
   personal/learning app with a sensitive scope (`calendar.readonly`), you can run
   *unverified in production* — users just see a one-time "Google hasn't verified this app"
   warning, and there's a 100-user cap. Full verification (privacy policy + verified domain
   + demo video) is unnecessary for single-user use.

2. **Register the loopback redirect URI.** APIs & Services → **Credentials** → click the
   **OAuth 2.0 Client ID** matching `GOOGLE_CLIENT_ID` (type *Web application*) → under
   **Authorized redirect URIs** add exactly:

   ```
   http://localhost:4180/oauth2callback
   ```

   Save. (You can remove it again after re-minting. Use a different port via `PORT=` below
   if 4180 is taken — keep the registered URI in sync.)

## Re-minting the token

From the repo root, with the same OAuth credentials the deploy workflow uses (the
`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` GitHub Actions secrets):

```bash
GOOGLE_CLIENT_ID=<client id> \
GOOGLE_CLIENT_SECRET=<client secret> \
GOOGLE_REFRESH_TOKEN_SSM_PATH=<ssm path, e.g. /ai-note-taker/google-refresh-token> \
node scripts/remint-google-refresh-token.mjs
```

The script ([`scripts/remint-google-refresh-token.mjs`](../../scripts/remint-google-refresh-token.mjs)):

1. Starts a loopback server on `http://localhost:4180/oauth2callback`.
2. Opens (and prints) the Google consent URL with `access_type=offline` + `prompt=consent`
   — the two parameters required to actually receive a refresh token.
3. After you grant access, exchanges the code (with PKCE) and prints the new **refresh
   token** plus the exact `aws ssm put-parameter` command to store it.

The client secret is never logged and nothing is written to disk.

## Storing the token in SSM

Use the command the script prints, or run it directly (note `--type SecureString`):

```bash
aws ssm put-parameter \
  --name "<GOOGLE_REFRESH_TOKEN_SSM_PATH>" \
  --type SecureString \
  --value "<the new refresh token>" \
  --overwrite
```

## Getting the Lambda to use the new token

`GoogleCalendarClient` caches the token in a static field with no TTL, so a warm instance
won't see the new value immediately. Two options:

- **Do nothing (self-healing).** On the next calendar call, the dead cached token triggers
  `invalid_grant`; the handler force-reloads from SSM and retries with the new token. The
  first request after the token died may still fail, but subsequent ones recover with no
  redeploy.
- **Force it (immediate).** Recycle the execution environments so the next cold start reads
  the fresh value right away:
  - Redeploy: `gh run rerun <latest-deploy-run-id>`, **or**
  - Bump the function config:
    ```bash
    aws lambda update-function-configuration \
      --function-name <function-name> \
      --description "recycle to reload refresh token $(date -u +%FT%TZ)"
    ```

## Troubleshooting

- **Script says "no refresh token returned".** Google only returns a refresh token the first
  time a client is authorised (unless `prompt=consent` forces a new one, which the script
  does). If it still doesn't appear, revoke the app at
  <https://myaccount.google.com/permissions> and re-run.
- **`redirect_uri_mismatch`.** The redirect URI isn't registered, or doesn't match exactly
  (scheme/host/port/path). Re-check the *Authorized redirect URIs* list; changes can take a
  minute to propagate.
- **Works again for ~7 days, then breaks.** The consent screen is still in *Testing*. Set it
  to *In production*.
