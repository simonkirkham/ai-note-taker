# Minting the Microsoft 365 (Outlook) calendar refresh token

The Lambda reads the owner's Microsoft 365 / Outlook calendar using a long-lived **refresh
token** stored in SSM Parameter Store at the path given by `MICROSOFT_REFRESH_TOKEN_SSM_PATH`.
When that token dies, calendar reads fail and the UI shows "Cannot connect to calendar".

It applies only while `CALENDAR_PROVIDER=microsoft` and the workspace has no in-app Outlook
connection (the SSM fallback). The Google equivalent was retired in 34-D1 (Google is fully in-app);
this Microsoft path retires in 34-D2 once in-app Outlook connect is verified.

## How it works

| Token | Lifetime | Who refreshes it |
|---|---|---|
| Access token | ~1 hour | The Lambda, automatically, on every call (`grant_type=refresh_token`) |
| Refresh token | long-lived | **A human, via the device-code mint below** — the Lambda cannot mint one |

The app registration is a **public client** (no client secret), so the runtime exchange uses
`client_id` + `refresh_token` only. The mint uses the OAuth 2.0 **device-authorization flow**.

## How to recognise the problem

In the Command Lambda's CloudWatch logs you'll see one of (from `MicrosoftCalendarClient`):

- `Entra rejected the calendar refresh token (invalid_grant) ... Reloading from SSM and
  retrying once.` — the Lambda noticed and re-read SSM. If you'd already stored a fresh
  token, the retry succeeds and the user never sees an error.
- `Microsoft refresh token in SSM is unchanged and still invalid (invalid_grant) ... Re-mint
  the token` — SSM still holds the dead token. **This is your cue to run the steps below.**

## One-time prerequisites (Microsoft Entra admin center)

In the app registration matching `MS_CLIENT_ID`:

1. **Public client flows enabled.** Authentication → *Allow public client flows* = **Yes**
   (device code requires it). No client secret is needed or used.
2. **Account types** include the calendar you're reading. For a personal `@outlook.com` /
   MSA mailbox, use tenant **`consumers`** (`MS_TENANT_ID`); for a work/school tenant use its
   GUID or `organizations`. `MS_TENANT_ID` must match what the deployed Lambda uses.
3. **API permissions** → delegated → Microsoft Graph → **`Calendars.Read`** (+ `offline_access`).

## Business / work-school (Entra ID) accounts

The runtime code is **identical** for a work/school account — only configuration changes. But
whether it actually works depends on the organisation's Entra policies, which you may not control.

**Config changes vs a personal account:**

| Setting | Personal (`@outlook.com` / MSA) | Work/school |
|---|---|---|
| `MS_TENANT_ID` | `consumers` | `organizations`, or the specific **tenant GUID** |
| App registration → *Supported account types* | personal MS accounts | must include **work/school** (multi-tenant, or register the app **inside the work tenant**) |
| `Calendars.Read` consent | self-service | may require **admin consent** (many orgs disable user consent) |

Set `MS_TENANT_ID` explicitly (it is **not** `consumers` for a work account) — both the mint
script and the runtime client must use the same value, or the refresh exchange fails with
`invalid_grant`.

**Org policies that can block it (not a code problem):**

1. **Conditional Access blocking the device-code grant.** Many tenants disable device-code flow by
   policy (it's a phishing vector), and Microsoft increasingly blocks it by default. If yours does,
   `mint-microsoft-refresh-token.mjs` won't complete. Fallback: in-app auth-code + PKCE
   (technical-improvements **TI-47**), or have an admin grant consent / approve the app.
2. **Token-lifetime / sign-in-frequency policies.** Work tenants can force periodic re-auth, so the
   "mint once, lasts weeks" model degrades to re-minting more often. The `invalid_grant` self-heal
   handles the failure gracefully — you just re-run the mint more frequently.
3. **App approval.** Some tenants require an admin to approve any app before users can sign in.

If device-code is blocked in your tenant, that is the signal to prioritise **TI-47** (in-app OAuth),
which is also the prerequisite for per-workspace calendars.

## Minting the token (and writing it to SSM in one step)

From the repo root, with `MS_CLIENT_ID` (the same value the deploy workflow uses). Set
`WRITE_SSM=1` and the script will mint **and** store the token for you — this avoids the
hand-typed `put-parameter`, which is the step that goes wrong (see *Common mistakes*):

```bash
MS_CLIENT_ID=<client id> \
MS_TENANT_ID=consumers \
MICROSOFT_REFRESH_TOKEN_SSM_PATH=/notetaker/microsoft-refresh-token \
AWS_PROFILE=prod AWS_REGION=eu-west-2 WRITE_SSM=1 \
node scripts/mint-microsoft-refresh-token.mjs
```

> The live app runs in the **prod** AWS account in **eu-west-2**. The `prod`/`test` CLI
> profiles default to **eu-west-1**, so `AWS_REGION=eu-west-2` is **required** — without it you
> write to the wrong region and nothing changes in prod.

The script ([`scripts/mint-microsoft-refresh-token.mjs`](../../scripts/mint-microsoft-refresh-token.mjs)):

1. Requests a device code and prints a one-line instruction:
   *"To sign in, use a web browser to open https://microsoft.com/devicelogin and enter the
   code XXXX-XXXX."*
2. You open that URL, sign in to the Outlook/MSA account, and consent to `Calendars.Read`.
3. It polls the token endpoint and, once you finish, prints the **refresh token** (issued
   because `offline_access` is in scope). With `WRITE_SSM=1` it then runs
   `aws ssm put-parameter ... --overwrite` (token passed via a 0600 temp file, deleted
   immediately, so it never enters the process list).

## Storing the token in SSM (manually)

If you didn't use `WRITE_SSM=1`, run the command the script prints. All three flags matter:

```bash
aws ssm put-parameter \
  --name "/notetaker/microsoft-refresh-token" \
  --type SecureString \
  --value "<the new refresh token>" \
  --overwrite \
  --profile prod --region eu-west-2
```

Then **verify it landed** — the version should bump and the date should be now:

```bash
aws ssm describe-parameters --profile prod --region eu-west-2 \
  --parameter-filters "Key=Name,Values=/notetaker/microsoft-refresh-token" \
  --query 'Parameters[0].{Version:Version,LastModified:LastModifiedDate}'
```

### Common mistakes (why your update silently didn't land)

1. **Missing `--overwrite`** → `put-parameter` errors with `ParameterAlreadyExists` and changes
   nothing. The token stays stale.
2. **Wrong `--profile`** → you updated the default/test account, not **prod**. Confirm with
   `aws sts get-caller-identity`.
3. **Wrong `--region`** → the profiles default to **eu-west-1**, but the param lives in
   **eu-west-2**. Always pass `--region eu-west-2`.

## Getting the Lambda to use the new token

`SsmMicrosoftRefreshTokenSource` caches the token in a field with no TTL, so a warm instance
won't see the new value immediately. Two options:

- **Do nothing (self-healing).** On the next calendar call, the dead cached token triggers
  `invalid_grant`; the client force-reloads from SSM and retries with the new token. The first
  request after the token died may still fail, but subsequent ones recover with no redeploy.
- **Force it (immediate).** Recycle the execution environments so the next cold start reads
  the fresh value right away:
  - Redeploy: `gh run rerun <latest-deploy-run-id>`, **or**
  - Bump the function config:
    ```bash
    aws lambda update-function-configuration \
      --function-name <command-function-name> \
      --description "recycle to reload refresh token $(date -u +%FT%TZ)"
    ```

## Switching the app to Microsoft

The provider is selected by the `CALENDAR_PROVIDER` env var on the Command Lambda
(`google` default). Set it to `microsoft` (and configure `MS_CLIENT_ID` / `MS_TENANT_ID` /
`MICROSOFT_REFRESH_TOKEN_SSM_PATH`) to back Home with Outlook. The bound provider is logged at
startup (`Calendar provider bound: microsoft`).

## Troubleshooting

- **"no refresh_token returned".** `offline_access` wasn't in scope, or the app registration
  lacks `Calendars.Read`. Fix the registration and re-run.
- **`AADSTS7000218` / "client_assertion or client_secret required".** The app registration is
  not configured as a public client — enable *Allow public client flows*.
- **Device code expires before you finish.** Re-run; you have ~15 minutes from the prompt.
- **Works, but Home shows no meetings.** Check `CALENDAR_PROVIDER=microsoft` is set on the
  **Command** Lambda (calendar GETs route there) and the resolved local-day window in the
  logs covers the meeting.
