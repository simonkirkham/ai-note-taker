# Phase 35 — Claude Cowork connector (read-only MCP server)

**Goal:** a **read-only remote MCP server** that lets Claude **Cowork / Desktop / claude.ai** connect to a workspace as a **custom connector** and digest its notes — list, read, search, and pull action items — in the user's own Claude session. For these clients a custom connector **is** a remote MCP server (the only native mechanism; they cannot call a plain REST API). **Scoped to one workspace per connector URL** (`/w/{wsId}/mcp`). Read-only this phase — Claude reasons over the notes, never mutates them. No new aggregates or events: the server is a new query (and, in 35-E, auth) surface over the **existing** read projections.

**Auth is staged — prove first, harden second (owner decision, 2026-06-24).** 35-A ships **no-auth** (unguessable per-workspace URL + Anthropic-IP allowlist) to prove the transport + Cowork handshake + workspace-scoped read on one real call; 35-B–D add the remaining read tools on that proven pattern; **35-E adds the OAuth 2.1 broker over Google** that flips the connector to authenticated. OAuth is **required** before the connector is considered production-complete — it is deferred past the proof, not dropped.

## Summary

| Slice | Summary | Status | Depends on |
|-------|---------|--------|------------|
| 35-A | **Connect & list — no-auth proof.** Remote MCP server at `/w/{wsId}/mcp` (official `ModelContextProtocol.AspNetCore` SDK) speaking the MCP transport (initialize / tools/list / tools/call); **no-auth** (unguessable workspace-id URL + Anthropic-IP allowlist); one tool — `list_notes` — returns the workspace's note titles/ids from `NoteCardList`. Proves transport + Cowork handshake + workspace-scoped read on one real call. | Done | — |
| 35-B | **`get_note`.** Tool returns a note's full digest — content, summary, discussion points, decisions, tags, action items — from `NoteDetail` + `NoteActions`. This is the slice that lets Cowork actually digest a meeting. | Not Started | 35-A |
| 35-C | **`search_notes`.** Tool queries across the workspace (`NoteSearchView`: title/body/final-notes/tags/actions) so Cowork can find relevant notes before digesting ("summarise my Acme meetings"). | Not Started | 35-A |
| 35-D | **`get_action_items`.** Tool lists the workspace's open to-dos from `TodoList` so Cowork can pull "what's outstanding". | Not Started | 35-A |
| 35-E | **OAuth 2.1 broker over Google (harden auth).** Add the Resource-Server + thin AS that brokers Google sign-in and mints audience-bound tokens; flip the connector from no-auth to authenticated (`.well-known` metadata, `/authorize`, `/token`, PKCE-S256, 401 challenge). **Required before production-complete.** | Done (dormant — owner config pending) | 35-A |

**35-A is the high-risk proving slice** — the hard part is the cross-cutting contract (MCP transport + Cowork handshake against our Lambda-hosted server), not any one tool. Shipping it **no-auth** makes it the *smallest* slice that proves that contract on one real call (the unguessable workspace-id URL is the access control; Anthropic-IP allowlist is defence-in-depth). Then **35-B/C/D are independent tool additions on the proven pattern** — any order, each shippable alone — and **35-E hardens auth** with the OAuth broker. 35-E depends only on 35-A (it can land before or after the extra tools), but should not be deferred indefinitely.

### Locked decisions

1. **Per-workspace connector URL `/w/{wsId}/mcp`.** Matches the existing Phase 23/34 `/w/{wsId}` routing; the user adds **one connector per workspace**, so workspace scoping is baked into the URL and there is **no in-protocol workspace selection** to build. (Honours "scoped by workspace" from slice 1.)
2. **Read-only.** Tools are `list_notes`, `get_note`, `search_notes`, `get_action_items` — no write/mutate tools this phase. Read+write (Claude creating notes/action items) is a **future phase**, not in scope.
3. **Auth is staged: no-auth proof (35-A) → OAuth broker (35-E).** 35-A relies on the unguessable per-workspace URL + Anthropic-IP allowlist (no user identity, no consent screen). 35-E adds the real auth: our server is the OAuth 2.1 **Resource Server** plus a **thin AS broker** that runs Google sign-in upstream (reusing the existing `GoogleOAuthClient` + redirect handling) and mints **audience-bound** tokens (RFC 8707) — you **cannot** point Claude directly at Google. Client creds are **pre-registered** (pasted into Cowork's Advanced settings); DCR is deprecated.
4. **No event-model changes.** No new commands/events/aggregates. The server reads existing projections only. The single net-new persisted state is whatever 35-E's OAuth flow needs (registered client / minted token), which extends the existing auth-tokens store pattern — not the event store.
5. **≤5 tools, terse tool descriptions.** Keeps the connector clear of the 2026 MCP context-bloat critique (large multi-tool servers tax every prompt). A 4-tool read-only server is the documented sweet spot.

### Routing & Lambda split (infra note)

- MCP **tool calls** are JSON-RPC over **POST** but are **read-only** — they must hit the **Query Lambda** (read-only projection grants). This **overrides** the default POST→Command routing, so `/w/{wsId}/mcp` (tool-call path) is **pinned to the Query integration** in API Gateway, exactly as calendar GETs are pinned to Command today. (Applies from 35-A.)
- **35-E only:** the OAuth endpoints (`/authorize`, `/token`, `.well-known/*`) need the **Google OAuth client** + secret access, which the Query Lambda lacks — so they are **pinned to the Command Lambda** (mirrors how calendar auth lives there). 35-A has no such endpoints.

### Resolved — source-driven research (2026-06-24, MCP spec 2025-11-25; see learnings)

| Question | Answer | Source |
|----------|--------|--------|
| Transport | Single `/mcp` endpoint; **POST → `application/json`, GET → 405**. Server-initiated SSE is **not** required for a tool-only server → no Lambda response-streaming. | spec/transports |
| Method set | `initialize` → `notifications/initialized` (202) → `tools/list` → `tools/call`; plus `ping`. No resources/prompts capability. | spec 2025-11-25/server/tools |
| Headers | Honour `MCP-Protocol-Version` (400 on unsupported); stay **stateless** (don't issue `Mcp-Session-Id`). (`Origin`/DNS-rebind validation is a localhost-server concern; not separately wired — this server is no-auth + IP-allowlisted.) | spec/transports |
| SDK | Use **`ModelContextProtocol.AspNetCore`** (official C# SDK, stable v1.0 Mar 2026, full 2025-11-25 + OAuth 2.1). Do **not** hand-roll JSON-RPC/transport. | github.com/modelcontextprotocol/csharp-sdk |
| Auth model | Our server **must be the OAuth 2.1 Resource Server**; the AS may be separate. **Cannot** delegate raw to Google — tokens must be **audience-bound** to our server (RFC 8707). "Reuse Google" = a **thin AS broker** that runs Google sign-in upstream and mints our own token. | spec/authorization |
| Client registration | **Pre-registration (paste client_id/secret in Claude's Advanced settings)**. DCR (RFC 7591) is deprecated, not required. PKCE S256 required. | spec/client-registration |
| Metadata endpoints | RS serves `/.well-known/oauth-protected-resource`; AS serves `/.well-known/oauth-authorization-server`. 401 challenge via `WWW-Authenticate: Bearer resource_metadata="…"`. | spec/authorization |
| Claude redirect URI | `https://claude.ai/api/mcp/auth_callback` (hosted/Cowork) — register against **our AS**, not Google. | claude.com/docs/connectors/building |
| Reachability | Public from Anthropic IP ranges, HTTPS. AWS API Gateway satisfies this; optionally IP-allowlist Anthropic ranges. | support.claude.com |

**Manual gates (cannot be automated — owner action):**
1. **Live Cowork handshake** is the literal 35-A acceptance ("a real Cowork client connects") — only the owner can add the connector in the Cowork GUI and confirm. The pipeline ships the server + full integration-test coverage of the MCP protocol; the owner does the final connect.
2. **OAuth approach** (below) determines whether a **Google Cloud Console redirect-URI registration** + **pasting client creds into Cowork** are also required owner steps.

**Deploy-time impact:** expected **neutral** (new route group + reuse of existing tables; no bake/canary, no new always-on infra). Confirm and state the delta in the 35-A PR.

### Deploy-time impact

**Neutral (to confirm in 35-A).** New minimal-API route group, one or two pinned API-Gateway integrations, and reuse of the existing auth-tokens + projection tables. No traffic-shifting, no new always-on compute beyond the existing Command/Query Lambdas. One-time prerequisite: register the MCP OAuth **redirect URI** in Google Cloud Console (reuse the Phase 8 client).

---

## Slice 35-A — Connect & list (no-auth proof)

**User value:** the owner pastes `https://<app>/w/<wsId>/mcp` into Cowork's *Add custom connector* (no auth), and Cowork can list that workspace's notes — proving the whole pipe before any OAuth is built.

**How (mechanics):** add the official **`ModelContextProtocol.AspNetCore`** SDK to `src/Api`; map its Streamable-HTTP MCP endpoint under `/w/{workspaceId}/mcp` (POST → `application/json`, GET → 405, stateless — no `Mcp-Session-Id`). One tool `list_notes` reads `NoteCardList` for the `workspaceId` taken from the route, returning id, title, date, preview. **No OAuth** — the workspace id in the URL is the access token; an **Anthropic-IP allowlist** (Lambda-side check of source IP, or WAF/API-GW) is defence-in-depth. Tool-call path pinned to the **Query** Lambda. Note: with no user identity, the read is scoped by `workspaceId` alone (single-user app) — `userId` scoping returns with OAuth in 35-E.

> **Security note (accepted, owner decision):** for the no-auth window the workspace's note titles/previews are readable by anyone who both knows the unguessable URL **and** reaches it from an Anthropic IP range. Accepted for a single-user app as the proving step; 35-E closes it.

### Scenarios
```
Scenario: Add the connector (no auth) and list tools
  Given my workspace has notes
  When  I add the /w/{wsId}/mcp connector in Cowork
  Then  Cowork lists the server's tools including list_notes

Scenario: List the workspace's notes
  Given the connector is added for my workspace
  When  Cowork calls list_notes
  Then  it returns that workspace's note titles, ids, dates and previews

Scenario: Workspace isolation
  Given two workspaces each with notes
  When  Cowork calls list_notes on /w/{wsA}/mcp
  Then  only workspace A's notes are returned — never workspace B's

Scenario: Wrong HTTP verb on the MCP endpoint
  Given the MCP endpoint at /w/{wsId}/mcp
  When  a GET request is made (no SSE)
  Then  the server responds 405 Method Not Allowed

Scenario: Unsupported protocol version
  Given a request with an unsupported MCP-Protocol-Version
  When  it reaches the server
  Then  the server responds 400
```

### Acceptance criteria
- MCP endpoint speaks the current transport via `ModelContextProtocol.AspNetCore` (`initialize` / `notifications/initialized` / `tools/list` / `tools/call` / `ping`); POST→`application/json`, GET→405, stateless.
- A **real Cowork client connects (no auth) and round-trips `list_notes`** against the deployed server (owner-run manual gate).
- `list_notes` reads `NoteCardList` scoped to the route `workspaceId`; returns id, title, date, preview.
- Tool-call path resolves on the **Query** Lambda (asserted in `Infrastructure.Assertions`).
- Cross-workspace reads are impossible (scope enforced from the route; covered by a spec).
- Inbound restricted to Anthropic IP ranges (mechanism Breaker's choice); the no-auth exposure is documented in the PR.
- Tool count ≤5, descriptions terse. PR + phase doc state the deploy-time delta.

---

## Slice 35-B — `get_note`

**User value:** Cowork reads a full meeting — content, summary, discussion points, decisions, tags, action items — so it can actually digest and synthesise, not just see titles.

**How:** add tool `get_note(noteId)` reading `NoteDetail` (+ `NoteActions` for the action list) filtered to the workspace; reject a `noteId` outside the connector's workspace.

### Scenarios
```
Scenario: Read a note's full digest
  Given the connector is authorized for my workspace
  When  Cowork calls get_note for a note in that workspace
  Then  it returns the content, summary, discussion points, decisions, tags and action items

Scenario: Note outside the workspace is rejected
  Given a noteId belonging to another workspace
  When  Cowork calls get_note with it
  Then  the call returns a not-found / forbidden MCP error, never that note
```

### Acceptance criteria
- `get_note` reads `NoteDetail` (+ `NoteActions`), workspace-scoped; rejects out-of-workspace ids.
- Returns the analysis fields (summary, discussion points, decisions) when present; absent fields are omitted, not faked.

---

## Slice 35-C — `search_notes`

**User value:** Cowork finds the relevant notes by query before digesting ("summarise my last three Acme meetings") instead of the user hunting note ids.

**How:** add tool `search_notes(query)` over `NoteSearchView` (`GetAllForUserAsync` then in-Lambda fuzzy rank), filtered to the workspace; return ranked id + title + snippet.

### Scenarios
```
Scenario: Search within the workspace
  Given the connector is authorized for my workspace
  When  Cowork calls search_notes with a query
  Then  it returns ranked matches (id, title, snippet) from that workspace only

Scenario: No matches
  Given a query matching nothing in the workspace
  When  Cowork calls search_notes
  Then  it returns an empty result, not an error
```

### Acceptance criteria
- `search_notes` reads `NoteSearchView`, workspace-scoped; returns ranked id/title/snippet.
- Empty result is a valid response, distinguishable from an error.

---

## Slice 35-D — `get_action_items`

**User value:** Cowork pulls the workspace's open to-dos so the user can ask "what are my outstanding actions across these meetings?"

**How:** add tool `get_action_items()` reading `TodoList` (`GetOpenItemsAsync(userId, workspaceId)`); return open items with their source note id/title.

### Scenarios
```
Scenario: List open action items
  Given the connector is authorized for my workspace
  When  Cowork calls get_action_items
  Then  it returns the workspace's open to-dos with their source note

Scenario: None open
  Given the workspace has no open action items
  When  Cowork calls get_action_items
  Then  it returns an empty list, not an error
```

### Acceptance criteria
- `get_action_items` reads `TodoList`, workspace-scoped; returns open items + source note.
- Empty list is a valid response.

---

## Slice 35-E — OAuth 2.1 broker over Google (harden auth)

**User value:** the connector stops being open-behind-a-URL — adding it requires Google sign-in, and tool calls are authorised against the owner's identity. Closes the 35-A no-auth window.

**How (mechanics):** make the MCP endpoint an OAuth 2.1 **Resource Server** (reject any request without a valid audience-bound bearer; 401 with `WWW-Authenticate: Bearer resource_metadata="…"`). Stand up a **thin Authorization Server** on the **Command** Lambda: serve `/.well-known/oauth-protected-resource` (RS) and `/.well-known/oauth-authorization-server` (AS); `/authorize` runs Google sign-in upstream (reuse `GoogleOAuthClient`), `/token` exchanges the PKCE-S256 code and mints **our own** token with `aud` = the MCP server `resource` URI (RFC 8707). Client is **pre-registered** (creds pasted into Cowork's Advanced settings). Re-scope every tool read to `(userId, workspaceId)` once identity is present, and re-add ownership enforcement.

### Scenarios
```
Scenario: Unauthenticated request is challenged
  Given the connector has no token
  When  Cowork makes any MCP request
  Then  the server returns 401 with a WWW-Authenticate resource_metadata pointer

Scenario: Authorize via Google and call a tool
  Given I add the connector with the pre-registered client creds
  When  I complete Google sign-in and Cowork exchanges the code for a token
  Then  tool calls succeed and are scoped to my (userId, workspaceId)

Scenario: Token for another resource is rejected
  Given a bearer token whose audience is not this MCP server
  When  it is presented to a tool call
  Then  the server rejects it (401) — audience-bound per RFC 8707

Scenario: Ownership enforced
  Given a workspace I do not own
  When  I complete auth and call a tool against /w/{thatWsId}/mcp
  Then  the call is rejected — no notes returned
```

### Acceptance criteria
- Every MCP request requires a valid **audience-bound** bearer; missing/invalid → 401 with the RFC 9728 `resource_metadata` challenge; wrong-audience token rejected.
- `.well-known` RS + AS metadata served; `/authorize` + `/token` implement auth-code + **PKCE S256**, brokering Google upstream and minting our own token.
- OAuth endpoints resolve on the **Command** Lambda; the Google redirect URI is registered in Google Cloud Console (owner one-time step) and Claude's `https://claude.ai/api/mcp/auth_callback` is the registered client redirect.
- All tools re-scoped to `(userId, workspaceId)`; cross-user **and** cross-workspace reads impossible (spec-covered).
- A **real Cowork client** completes Google auth and round-trips a tool (owner-run manual gate).
- Deploy-time delta stated; no bake/canary.

---

## Observability

Silent failure modes per slice (from `observability-brief`) — what must be visible in prod, since every failure here is invisible to the owner (Cowork just shows "couldn't connect" or "no results"):

| Slice | Silent failure | Instrumentation |
|-------|----------------|-----------------|
| 35-A | MCP handshake fails (`initialize`/`tools/list` malformed) — Cowork silently drops the connector | Log each MCP method + outcome + workspace; metric on method error rate |
| 35-A | **Cross-workspace leak** — a scoping bug returns another workspace's notes with no error | Spec asserts isolation; log `workspaceId` on every tool call for audit |
| 35-A | Non-Anthropic IP reaches the no-auth endpoint | Log + metric source IP vs allowlist; alarm on allowlist miss |
| 35-A–D | Tool returns empty due to **projector lag** (RYW) — looks identical to "no data" | Metric distinguishing empty-no-data vs empty-stale; reuse the `proj-position` gate |
| 35-B–D | A tool throws and returns a raw 500 Cowork can't interpret | Each tool emits a structured log (tool, workspace, arg summary, result count, latency); errors return a proper **MCP error payload**, not a 500 |
| 35-E | OAuth authorize/token fails — user sees only "couldn't connect" | Structured log + metric on every authorize/token outcome; alarm on token-exchange failure rate |
| 35-E | Wrong-audience or expired token silently accepted (**confused-deputy**) | Log every token validation outcome (aud, exp, result); metric + alarm on validation failures |

---

## Status log

**35-A — Done** (PR #335, deploy #636, 2026-06-24). Prod route `POST /w/{workspaceId}/mcp` verified live on api `z5a9ffln2j` (`aws apigatewayv2 get-routes --profile prod`). No new projection → no backfill. Three Hawk rounds: (1) flagged the IP allowlist reading the wrong IP + default-workspace dropping legacy notes; (2) caught that the XFF "fix" was a spoofable security regression — reverted to `RemoteIpAddress` (= AWS `sourceIp`, non-spoofable for this regional HTTP API); (3) APPROVE. See [phase-35a-mcp-connect-list](../learnings/phase-35a-mcp-connect-list.md).

**Owner manual gate — CONFIRMED (2026-06-24):** owner added the connector in Cowork (via **Connectors panel → `+`**, name + URL, no auth) and `list_notes` returned the workspace's notes. The MCP transport + Cowork handshake + workspace-scoped read are proven end-to-end against a real client — the prove-first re-slice is validated. Connector URL (no auth): `https://z5a9ffln2j.execute-api.eu-west-2.amazonaws.com/w/__default__/mcp` — the **`execute-api`** URL, **not** the app/CloudFront domain (CloudFront only fronts `/api/*`; the app domain would 404). Optionally set `MCP_ALLOWED_CIDRS` to Anthropic's IP ranges (default empty = open).

> **35-E note:** the IP allowlist relies on the route being on the raw HTTP API (so `RemoteIpAddress` = the real `sourceIp`). If 35-E ever fronts the MCP path with CloudFront, `sourceIp` becomes a CloudFront edge IP and the allowlist breaks — keep it on the HTTP API or change the IP source.

**35-E — Done (PR #341, deploy #643, 2026-06-25).** OAuth 2.1 RS (SDK `AddMcp` + dedicated `McpBearer` HS256 scheme) + hand-rolled AS broker over Google (HS256 audience-bound tokens, PKCE-S256, single-use 60s codes, sub↔workspace binding, fail-closed allowlist + signing key). `MCP_ENABLED` re-enabled WITH auth. **Prod verified:** MCP endpoint `401` (was `404`), AS metadata `200`, all 5 routes present (`/oauth/authorize|token|google/callback`, `/.well-known/oauth-authorization-server`, `/w/{ws}/mcp`). Dual review (Hawk + security-auditor, 2 audit rounds) found + fixed a prod-config break + two fail-open defaults + a confused-deputy case-sensitivity bypass. Deploy needed 3 attempts (1 E2E flake; 2 orphaned-RETAIN resources from a parallel stale re-run — cleared the test-env orphans). See [phase-35e-oauth-broker](../learnings/phase-35e-oauth-broker.md).

**Owner bring-online (outstanding manual gate):** the endpoint is **secured-but-dormant** (401; `/oauth/authorize` 503s until configured). To activate: (1) GitHub **secret** `MCP_OAUTH_CLIENT_ID` (chosen id) + **var** `MCP_OAUTH_ISSUER` = `https://z5a9ffln2j.execute-api.eu-west-2.amazonaws.com` + confirm `ALLOWED_USER_SUBS` holds the owner's Google `sub`; (2) redeploy; (3) register `…/oauth/google/callback` in Google Cloud Console (Phase 8 client); (4) paste the same client id into Cowork → sign in.

**Remaining in Phase 35:** 35-B `get_note`, 35-C `search_notes`, 35-D `get_action_items` (the additional read tools) are still Not Started — now they land behind OAuth from the start.

**Disabled in prod pending 35-E (PR #337, deploy #638, 2026-06-24).** Once the owner confirmed the handshake, the no-auth window was closed via an `MCP_ENABLED` kill switch: `Program.cs` maps the endpoint only when the flag is true (default true for tests/local); CDK sets `MCP_ENABLED=false` on the shared Lambda env. **Prod 404 verified** (`POST …/w/__default__/mcp` → 404 while `/health` → 200). **35-E re-enables by flipping `MCP_ENABLED=true` with OAuth in place** — the build of the OAuth Resource Server + AS-broker (35-E) should land the auth *and* the re-enable in the same slice so the endpoint is never live without auth.
