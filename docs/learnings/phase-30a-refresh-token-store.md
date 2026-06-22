# 30-A — Server-side refresh-token store

**Slice:** 30-A (PR #301, deploy #603). New `IRefreshTokenStore` (DynamoDB `notetaker-auth-tokens`, PK `sub`, SSE, RETAIN); `/auth/token` persists the Google refresh token keyed by `sub` and restores the `rt` cookie from it on a returning, prompt-less sign-in.

## The non-obvious lesson: an unvalidated `sub` is a store *key*, never an authz *subject* for a destructive write

The `sub` claim is decoded from the Google id_token **without signature validation** — fine, because the token came directly from Google's token endpoint over TLS (or is re-validated by the bearer middleware on every other route). That trust basis covers using `sub` as a **lookup/store key**. It does **not** cover using `sub` to authorize a **mutation**.

The first cut of the revoked-token cleanup did exactly that: on a Google-rejected refresh, `/auth/refresh` (which is `AllowAnonymous`) called `tokenStore.DeleteAsync(sub)` with `sub` taken from the unvalidated `Authorization` header, with **no binding to the cookie token**. That is an unauthenticated destructive-write primitive: an attacker sends `rt=<any-garbage>` (Google rejects it) + `Authorization: Bearer <forged JWT with the victim's sub>` and evicts the victim's durable token — re-triggering the exact consent-screen symptom this phase exists to remove.

**Fix:** bind the delete to **proof of possession** of the credential being evicted — delete only when the presented (now-rejected) cookie token *equals* the stored token (`string.Equals(stored, refreshToken, Ordinal)`). The forged `sub` then only selects *which row to compare*; it grants no delete power without the secret the attacker cannot know.

**Generalises to:** any anonymous endpoint that reads an unsigned/loosely-trusted identifier. Trusting it to *key a read* is fine; trusting it to *authorize a write/delete* is a hole. Gate the mutation on something the caller must actually possess (the matching credential, a validated signature, or an allowlist membership).

## Other points
- The negative-authorization test (`RefreshRejected_ForgedSubWithNonMatchingToken_DoesNotDeleteVictimEntry`) is the one that would have caught it — seed a victim, attack with a non-matching cookie + forged sub, assert the victim's entry **survives**. Positive-only delete tests (matching token) pass either way.
- Residual timing side-channel on the ordinal compare is immaterial here (high-entropy opaque token, same 401 either way, single-user app) — not worth a constant-time compare.
- Not a projection → no backfill; the table ships empty and fills as users sign in. Infra verified live in prod (`describe-table`: ACTIVE, PK `sub`, SSE ENABLED) per the infra-slice guardrail.
