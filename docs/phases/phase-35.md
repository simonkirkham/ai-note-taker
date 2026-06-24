# Phase 35 — Claude Cowork connector (read-only MCP server)

**Goal:** a **read-only remote MCP server** that lets Claude **Cowork / Desktop / claude.ai** connect to a workspace as a **custom connector** and digest its notes — list, read, search, and pull action items — in the user's own Claude session. For these clients a custom connector **is** a remote MCP server (the only native mechanism; they cannot call a plain REST API). Authenticated as the existing Google identity; **scoped to one workspace per connector URL** (`/w/{wsId}/mcp`). Read-only this phase — Claude reasons over the notes, never mutates them. No new aggregates or events: the server is a new query + auth surface over the **existing** read projections.

## Summary

| Slice | Summary | Status | Depends on |
|-------|---------|--------|------------|
| 35-A | **Connect & list (end-to-end proof).** Remote MCP server at `/w/{wsId}/mcp` speaking the MCP transport (initialize / tools/list / tools/call); connector **OAuth** reusing the Google identity; one tool — `list_notes` — returns the workspace's note titles/ids from `NoteCardList`. Proves transport + connector-OAuth + workspace-scoped read on one real Cowork call. | Not Started | — |
| 35-B | **`get_note`.** Tool returns a note's full digest — content, summary, discussion points, decisions, tags, action items — from `NoteDetail` + `NoteActions`. This is the slice that lets Cowork actually digest a meeting. | Not Started | 35-A |
| 35-C | **`search_notes`.** Tool queries across the workspace (`NoteSearchView`: title/body/final-notes/tags/actions) so Cowork can find relevant notes before digesting ("summarise my Acme meetings"). | Not Started | 35-A |
| 35-D | **`get_action_items`.** Tool lists the workspace's open to-dos from `TodoList` so Cowork can pull "what's outstanding". | Not Started | 35-A |

**35-A is the high-risk proving slice** — the hard part is the cross-cutting contract (MCP transport + connector OAuth handshake with a real Cowork client), not any one tool. Prove it on `list_notes` first, then **35-B/C/D are independent tool additions on the proven pattern** — any order, each shippable alone. Recommend a throwaway **spike against a live Cowork client** (no-auth local server → confirm Cowork connects and round-trips one tool call) before committing 35-A's auth + infra, mirroring the Phase 31 Windows spike and the Phase 33 engine spike.

### Locked decisions

1. **Per-workspace connector URL `/w/{wsId}/mcp`.** Matches the existing Phase 23/34 `/w/{wsId}` routing; the user adds **one connector per workspace**, so workspace scoping is baked into the URL and there is **no in-protocol workspace selection** to build. (Honours "scoped by workspace" from slice 1.)
2. **Read-only.** Tools are `list_notes`, `get_note`, `search_notes`, `get_action_items` — no write/mutate tools this phase. Read+write (Claude creating notes/action items) is a **future phase**, not in scope.
3. **Reuse the Google OAuth identity** via the connector's OAuth flow — no new user-facing credential type. Recommended model: our server acts as the OAuth **authorization server delegating to Google**, reusing the existing `GoogleOAuthClient` + redirect handling from `AuthEndpoints` / `CalendarAuthEndpoints`. (Resource-server-validates-Google-id-token is the fallback if the MCP auth spec requires our own AS — confirm during 35-A.)
4. **No event-model changes.** No new commands/events/aggregates. The server reads existing projections only. The single net-new persisted state is whatever the MCP OAuth flow needs (client registration / token), which extends the existing auth-tokens store pattern — not the event store.
5. **≤5 tools, terse tool descriptions.** Keeps the connector clear of the 2026 MCP context-bloat critique (large multi-tool servers tax every prompt). A 4-tool read-only server is the documented sweet spot.

### Routing & Lambda split (infra note)

- MCP **tool calls** are JSON-RPC over **POST** but are **read-only** — they must hit the **Query Lambda** (read-only projection grants). This **overrides** the default POST→Command routing, so `/w/{wsId}/mcp` (tool-call path) is **pinned to the Query integration** in API Gateway, exactly as calendar GETs are pinned to Command today.
- MCP **OAuth endpoints** (`/authorize`, `/token`, metadata) need the **Google OAuth client** + SSM/secret access, which the Query Lambda lacks — so they are **pinned to the Command Lambda** (mirrors how calendar auth lives there). Confirm the exact endpoint set against the MCP auth spec in 35-A.

### Open questions (resolve in 35-A via `source-driven-development` against modelcontextprotocol.io)

1. Exact **transport** — Streamable HTTP version; whether Cowork requires the SSE (`GET`) stream or request/response POST suffices.
2. Exact **auth spec** — protected-resource + authorization-server metadata (`/.well-known/...`); **dynamic client registration (RFC 7591)** vs. the connector UI accepting a pasted client id/secret; PKCE.
3. **Reachability** — server must be public from Anthropic's IP ranges (the AWS API is already public; confirm no WAF/allowlist blocks it).
4. **Deploy-time impact** — expected **neutral** (new route group + one pinned integration + reuse of existing tables; no bake/canary, no new always-on infra). Confirm and state the delta in the 35-A PR.

### Deploy-time impact

**Neutral (to confirm in 35-A).** New minimal-API route group, one or two pinned API-Gateway integrations, and reuse of the existing auth-tokens + projection tables. No traffic-shifting, no new always-on compute beyond the existing Command/Query Lambdas. One-time prerequisite: register the MCP OAuth **redirect URI** in Google Cloud Console (reuse the Phase 8 client).

---

## Slice 35-A — Connect & list (end-to-end proof)

**User value:** the owner pastes `https://<app>/w/<wsId>/mcp` into Cowork's *Add custom connector*, signs in once with Google, and Cowork can list that workspace's notes — the foundation for every later digest.

**How (mechanics):** a new `McpEndpoints` route group at `/w/{wsId}/mcp` handling the MCP JSON-RPC methods `initialize`, `tools/list`, `tools/call`; one tool `list_notes` reading `NoteCardList` filtered to `(userId, workspaceId)` (id, title, date, preview). Connector OAuth endpoints delegate to Google (reuse `GoogleOAuthClient`). Tool-call path pinned to the **Query** Lambda; OAuth path pinned to **Command**. Ownership enforced by the existing `WorkspaceValidationFilter` (or an equivalent on the MCP group).

### Scenarios
```
Scenario: Add the connector and authorize
  Given I am signed in and my workspace has notes
  When  I add the /w/{wsId}/mcp connector in Cowork and complete Google OAuth
  Then  Cowork lists the server's tools including list_notes

Scenario: List the workspace's notes
  Given the connector is authorized for my workspace
  When  Cowork calls list_notes
  Then  it returns that workspace's note titles, ids, dates and previews

Scenario: Workspace isolation
  Given my workspace and another user's workspace both have notes
  When  Cowork calls list_notes on my connector
  Then  only my workspace's notes are returned — never another workspace's or user's

Scenario: Unauthorized / expired token re-challenges
  Given my connector token is missing or expired
  When  Cowork makes any MCP request
  Then  the server returns the MCP auth challenge and Cowork re-runs OAuth

Scenario: Ownership enforced
  Given a workspace I do not own
  When  OAuth completes and a tool is called against /w/{thatWsId}/mcp
  Then  the call is rejected (no notes returned)
```

### Acceptance criteria
- Server speaks the current MCP transport (`initialize` / `tools/list` / `tools/call`) — verified against modelcontextprotocol.io at build, not assumed.
- A real Cowork client connects, authorizes via Google, and round-trips `list_notes` against the deployed server.
- `list_notes` reads `NoteCardList` filtered to `(userId, workspaceId)`; returns id, title, date, preview.
- Tool-call path resolves on the **Query** Lambda; OAuth path on the **Command** Lambda; both asserted in `Infrastructure.Assertions`.
- Cross-workspace and cross-user reads are impossible (server-side scope enforced; covered by a spec).
- Tool count ≤5, descriptions terse.
- PR + phase doc state the deploy-time delta.

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

## Observability

Silent failure modes per slice (from `observability-brief`) — what must be visible in prod, since every failure here is invisible to the owner (Cowork just shows "couldn't connect" or "no results"):

| Slice | Silent failure | Instrumentation |
|-------|----------------|-----------------|
| 35-A | Connector OAuth fails (authorize/token error) — user sees only "couldn't connect" | Structured log + metric on every authorize/token outcome; alarm on token-exchange failure rate |
| 35-A | MCP handshake fails (`initialize`/`tools/list` malformed) — Cowork silently drops the connector | Log each MCP method + outcome + workspace; metric on method error rate |
| 35-A | **Cross-workspace/user leak** — a scoping bug returns another user's notes with no error | Spec asserts isolation; log `workspaceId` + `userId` on every tool call for audit |
| 35-A–D | Tool returns empty due to **projector lag** (RYW) — looks identical to "no data" | Metric distinguishing empty-no-data vs empty-stale; reuse the `proj-position` gate |
| 35-B–D | A tool throws and returns a raw 500 Cowork can't interpret | Each tool emits a structured log (tool, workspace, arg summary, result count, latency); errors return a proper **MCP error payload**, not a 500 |

---

## Status log

_(Scribe updates the Summary `Status` cells and appends per-slice deploy notes here as slices land.)_
