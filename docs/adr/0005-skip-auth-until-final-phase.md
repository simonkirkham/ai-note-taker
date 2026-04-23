# ADR 0005 — Skip auth until the final phase

**Status:** Accepted

## Context

A note-taking app eventually needs auth. Three sensible places to introduce it:

- **At the start** — the "do it properly" instinct, but it competes for attention with event sourcing learning.
- **At Calendar integration** — Google OAuth is needed for the Calendar API anyway; could double as user auth.
- **At the end** — keep all earlier phases focused on event sourcing.

## Decision

**Skip auth entirely** for Phases 0–4. Use a hardcoded single-user ID. Introduce **personal Google OAuth** (single refresh token, no sign-in flow) when Calendar integration lands. Add **multi-user Google Sign-In** in the final phase (Phase 7).

## Consequences

- Earlier phases stay focused on event sourcing and the agentic workflow without auth ceremony.
- Personal OAuth in Phase 5 is a bounded scope — no user pool, no JWT verification, just a stored refresh token for the developer's own Google account.
- Phase 7 is a deliberate chunk of work on real auth — done at a point when the system is established enough to be worth securing.
- Risk: auth retrofit is harder than greenfield. Mitigation: aggregate IDs and projection keys carry user ID from day one even though it's hardcoded — switching to a real user ID at Phase 7 becomes a wiring change, not a model change.

## Alternatives considered

- **AWS Cognito from day one** — overkill for a single-user side project; user pool / authoriser setup is more learning surface than the project needs.
- **Skip auth entirely** — would block Calendar integration.
