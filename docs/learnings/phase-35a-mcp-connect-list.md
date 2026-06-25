# 35-A — Read-only MCP server (Claude Cowork connector), no-auth proof

Slice 35-A shipped a read-only remote MCP server at `POST /w/{workspaceId}/mcp` (one tool, `list_notes`) so Claude Cowork can list a workspace's notes. PR #335, deploy #636. Prod route verified live (`aws apigatewayv2 get-routes` on api `z5a9ffln2j`).

## Non-obvious whys worth keeping

### 1. Behind a regional API Gateway HTTP API, `Connection.RemoteIpAddress` IS the trustworthy client IP — `X-Forwarded-For` is *worse*
The IP allowlist (defence-in-depth for the no-auth window) went through three review rounds because the IP source is counter-intuitive:
- `Amazon.Lambda.AspNetCoreServer` sets `HttpContext.Connection.RemoteIpAddress` from `requestContext.http.sourceIp` — the **AWS-computed** TCP peer. For a regional `execute-api` endpoint that is the real caller and is **not** spoofable.
- API Gateway **appends** the real peer to whatever `X-Forwarded-For` the client sent. So the **left-most** XFF entry is **attacker-controlled** — reading it makes an allowlist bypassable with one forged header.
- **Rule:** for API Gateway HTTP API + Lambda, allowlist/rate-limit on `RemoteIpAddress` (= `sourceIp`). Never trust raw XFF. (Codified as a CLAUDE.md guardrail.)
- **Process note:** review round 1 *mis*diagnosed `RemoteIpAddress` as "the proxy IP" and asked for an XFF fix; that fix introduced the spoofable bypass; round 2 (which verified against the decompiled Lambda marshaller + the CDK routing) caught it. Lesson: a security "fix" must be validated against the **actual deployment topology**, not a generic "behind a proxy" assumption — and adversarial re-review earns its keep.

### 2. The connector URL is the `execute-api` URL, not the app/CloudFront domain
CloudFront only fronts `/api/*`; the MCP route is added directly to the HTTP API. So the owner must paste `https://z5a9ffln2j.execute-api.eu-west-2.amazonaws.com/w/<wsId>/mcp` — the app domain would 404 at CloudFront's SPA default behaviour. Corollary for **35-E**: if the MCP path is ever fronted by CloudFront, `sourceIp` becomes a CloudFront edge IP and the IP allowlist breaks — keep it on the raw HTTP API or switch the IP source.

### 3. "Reuse Google identity" for an MCP connector = building an OAuth 2.1 AS broker, not a thin delegation
Source-driven research (MCP spec 2025-11-25) showed the server **must** be the OAuth Resource Server and tokens must be **audience-bound to it** (RFC 8707) — you cannot point Claude directly at Google. That is real, security-sensitive work, separable from proving the transport. Hence the owner-approved **re-slice**: 35-A no-auth (prove the Cowork handshake on one real call), OAuth deferred to 35-E. Validated the project guardrail — find the smallest slice that proves the cross-cutting contract first.

### 4. MCP C# SDK (`ModelContextProtocol.AspNetCore` 1.4.0) specifics
- `app.MapMcp("/w/{workspaceId}/mcp")` accepts a parameterised route directly — no wrapper needed.
- `WithHttpTransport(o => o.Stateless = true)` suits Lambda; in stateless mode (default `PerSessionExecutionContext=false`) tool handlers run on the request's execution context, so a tool can read the route value via injected `IHttpContextAccessor` (`RouteValues["workspaceId"]`).
- `GET → 405` and unsupported `MCP-Protocol-Version → 400` are enforced by the SDK's `StreamableHttpHandler` — don't hand-roll them.
- NuGet is ground truth for SDK maturity — the research's "stable v1.0" was right but the feed head showed only `0.x-preview`; the latest stable is 1.4.0.

### 5. Reuse the workspace-scope helper, don't re-implement equality
`list_notes` first used `c.WorkspaceId == workspaceId`, which dropped legacy null-workspace notes from a `/w/__default__/mcp` connector. The app's `WorkspaceScopeExtensions.Includes` already treats a null/empty row workspace as the default. Refactored it to a shared `Matches(workspaceId, rowWorkspaceId)` static so both the request path and the MCP tool use one source of truth.

## Test note
Testing an IP allowlist that reads `RemoteIpAddress` needs a test seam: a test-only `IStartupFilter` maps a header onto `Connection.RemoteIpAddress` (mirrors what the Lambda host does with `sourceIp`), so the allow/block tests exercise the real path — not a spoofable XFF header. Configure `MCP_ALLOWED_CIDRS` via `IConfiguration`/in-memory (not a process-global env var) to honour the env-mutation guardrail.

## Owner manual gate (outstanding)
35-A's acceptance ("a real Cowork client connects and lists notes") is owner-run. Connect URL: `https://z5a9ffln2j.execute-api.eu-west-2.amazonaws.com/w/__default__/mcp` (no auth). Optional: populate `MCP_ALLOWED_CIDRS` with Anthropic's IP ranges (default empty = open).
