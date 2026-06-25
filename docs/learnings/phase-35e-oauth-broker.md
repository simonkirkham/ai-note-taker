# 35-E — OAuth 2.1 for the remote MCP server (RS + thin AS-broker over Google)

Secured the Cowork connector: the MCP endpoint became an OAuth 2.1 **Resource Server** and a hand-rolled thin **Authorization Server** that brokers Google sign-in and mints **audience-bound HS256** tokens. `MCP_ENABLED` flipped back on — re-enabled WITH auth (unauthenticated → 401). PR #341, deploy #643. Prod verified: MCP endpoint `401` (was `404`), AS metadata `200`, all 5 OAuth/MCP routes present.

## Architecture that worked

| Half | Approach | Why |
|------|----------|-----|
| Resource Server | **SDK** (`ModelContextProtocol.AspNetCore` `AddMcp` serves protected-resource metadata + the 401 `WWW-Authenticate` challenge) + a **dedicated `McpBearer` HS256 `JwtBearer` scheme** (separate from the app's Google bearer, so a Google token is never accepted at the RS) | Don't hand-roll RS plumbing; the SDK does metadata + challenge |
| Authorization Server | **Hand-rolled** `/oauth/authorize` → Google → `/oauth/google/callback` → `/oauth/token` on the Command Lambda | OpenIddict/Duende are over-scoped for one user / one client / no-DCR on Lambda |
| Token signing | **HMAC (HS256)**, secret in Secrets Manager, `GrantRead` to Command (sign) + Query (verify) | No JWKS required by Claude/spec; symmetric is simplest secure for this topology |
| Stores | DynamoDB auth-code (DESTROY + 60s TTL) + refresh (RETAIN + TTL) | Stateless Lambda needs server-side single-use codes |

## The dual-review caught what a single lens would miss

Running **both** `code-reviewer` (Hawk) and `security-auditor` on the OAuth surface was decisive — each found a distinct critical class:
- **Security-auditor only:** the AS was **non-functional in prod** — `MCP_OAUTH_CLIENT_ID` was never wired through `Infrastructure/Program.cs` or `deploy.yml`, so `IsConfigured=false` → `/oauth/*` 503. A fail-*closed* break, invisible to correctness review and to the build's own green tests (the props are passed directly in tests). **Guardrail reinforced:** when a CDK prop comes from a GitHub secret, grep `deploy.yml` for it in *every* `cdk deploy` env block — assertion tests build the stack with props directly and never catch a missing workflow `env:` line (same trap as 32-B).
- **Two fail-OPEN defaults** the auditor flagged that Hawk's correctness lens framed as style: an empty `ALLOWED_USER_SUBS` allowed any Google user, and an absent signing secret fell back to a **known `'0'×32` key** (anyone could mint a valid token if the secret ever failed to load). Both made fail-*closed* (deny / random per-process key).
- **Confused-deputy depth:** the per-workspace `aud` binding lived only in the tool body. Lifted to a per-request middleware on `/w/{ws}/mcp` (403 before any tool, covering `initialize`/`tools/list`). **Round 2 found the fix incomplete:** the middleware parsed the path **case-sensitively** while ASP.NET routes **case-insensitively**, so `/w/{ws}/MCP` and `/W/{ws}/mcp` reached the endpoint skipping the binding. A second audit pass is worth it on auth code — the first fix can reopen the hole.

**Lesson:** for an auth/crypto surface, run the security-auditor *in addition to* Hawk, and **re-audit after the fixes** — the residual case-sensitivity bypass survived into round 2.

## The deploy incident: orphaned RETAIN resources from a parallel stale re-run

Deploy #643 failed 3 ways before going green, and only the first was a flake:
1. **Attempt 1:** infra deployed fine; the E2E gate hit the chronic cold-start flake (`ActionItemJourney`, unrelated to 35-E).
2. **Attempt 2:** `cdk deploy` failed — `notetaker-mcp-refresh-token` table "already exists."
3. **Attempt 3:** `cdk deploy` failed — secret `notetaker-mcp-jwt-signing-key` "already exists."

**Root cause:** a parallel session re-ran an *older* deploy, which replayed a **pre-35-E template** and removed 35-E's new resources from the test stack. The table (RETAIN) and secret (recovery window) **survived physically as orphans**; the auth-code table (DESTROY) was deleted. The next `cdk deploy` then couldn't recreate the orphaned-by-name resources. This is the exact "drive autonomous re-run loops strictly sequentially — one deploy in flight at a time" hazard, seen from the receiving end.

**Diagnosis pattern (reusable):** `cdk deploy` "X already exists" on a *new* resource with an explicit physical name → the resource is **orphaned** (exists physically, not in the stack). Confirm: `describe-stacks` shows `UPDATE_COMPLETE` (healthy) but `describe-stack-resources` does **not** list the logical id, while the physical resource exists. **Fix:** delete the orphan in the affected env, then re-deploy — cdk recreates it cleanly.
- Table: `aws dynamodb delete-table` + `wait table-not-exists`.
- Secret: `aws secretsmanager delete-secret --force-delete-without-recovery` (a normal delete leaves a recovery window that still blocks same-name recreation).
- The **test env is a separate AWS account** (`--profile test`, not `prod`) — inspect/clean there.

**Prod was unaffected** — `deploy-production` only runs after the E2E gate passes, so the failed attempts never touched prod; its first 35-E deploy was a clean create.

## Owner bring-online (manual gate, outstanding)
1. GitHub **secret** `MCP_OAUTH_CLIENT_ID` (chosen client id) + **variable** `MCP_OAUTH_ISSUER` = the execute-api host (exact, no trailing slash) + confirm `ALLOWED_USER_SUBS` holds the owner's Google `sub`.
2. Redeploy (the secret/var are read at `cdk deploy` time).
3. Google Cloud Console: register `https://z5a9ffln2j.execute-api.eu-west-2.amazonaws.com/oauth/google/callback` on the Phase 8 client.
4. Cowork: paste the same `MCP_OAUTH_CLIENT_ID` into the connector's Advanced settings; complete Google sign-in.

Until step 1+2, the endpoint is **secured-but-dormant** (401; the AS 503s `/authorize` because it's unconfigured) — the correct safe interim state.
