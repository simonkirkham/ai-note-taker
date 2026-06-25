# ADR 0005 — Skip auth until Phase 8; then add real Google Sign-In

**Status:** Amended (originally "skip auth until the final phase")

## Context

A note-taking app eventually needs auth. Three sensible places to introduce it:

- **At the start** — the "do it properly" instinct, but it competes for attention with event sourcing learning.
- **At Calendar integration** — Google OAuth is needed for the Calendar API anyway; could double as user auth.
- **Before Calendar integration** — auth first, then Calendar builds on top of a secured system.
- **At the end** — keep all earlier phases focused on event sourcing learning.

## Decision

**Skip auth entirely** for Phases 0–7. Use a hardcoded single-user ID. Introduce **multi-user Google Sign-In** in **Phase 8** — before Calendar integration — so the Calendar phase builds on a properly secured and user-scoped API.

The original plan deferred auth to the final phase. That was revised because:
- The API and UI are publicly accessible without auth, which is unacceptable even for a learning project once real data is in use.
- Adding auth before Calendar is cleaner than retrofitting it into an already-complex phase.
- Phase 8 auth (PKCE + JWT verification) is a bounded, teachable scope that fits between the TipTap/UX work of Phase 7 and the outbound-HTTP complexity of Phase 9.

## Consequences

- Phases 0–7 stay focused on event sourcing and the agentic workflow without auth ceremony.
- Phase 8 is a deliberate chunk of work on real auth — PKCE, OIDC, JWT Bearer middleware — done at a point when the system is established enough to be worth securing.
- Phase 9 (Calendar) builds on top of a secured system; `EventMetadata.UserId` is already populated from the JWT before Calendar work begins.
- `GOOGLE_ACCOUNT_ID` env var (originally planned for the Calendar phase to set UserId) is no longer needed; the sub claim does the job.
- Risk: auth retrofit is harder than greenfield. Mitigation: aggregate IDs and projection keys carry user ID from day one even though it's hardcoded — switching to a real user ID in Phase 8 is a wiring change, not a model change.
- Pre-Phase-8 data (with `UserId = null`) is orphaned in place and never returned to any authenticated user. Acceptable for a learning project.

## Alternatives considered

- **AWS Cognito** — adds a user pool, managed sign-in UI, and a Cognito authoriser. More infrastructure to maintain; the OIDC learning comes from Cognito's internals rather than from understanding the JWT flow directly. Direct Google OIDC gives the same security with more visible mechanics.
- **Auth at Calendar integration** — the original amended plan; rejected because it left the API unsecured through Phases 8–8 and tangled auth concerns with Calendar concerns in the same phase.
- **Skip auth entirely** — was the original original plan; not viable for a real deployment.
