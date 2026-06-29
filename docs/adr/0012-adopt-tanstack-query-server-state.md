# ADR 0012 — Adopt TanStack Query for server state (supersedes ADR 0010)

**Status:** Accepted

**Date:** 2026-06-05

**Supersedes:** [ADR 0010](0010-server-state-strategy.md)

## Context

[ADR 0010](0010-server-state-strategy.md) deferred a server-state library and kept the hand-rolled `useEffect`-fetch + `useState` hooks, on one explicit premise: this repo is a **learning vehicle** ("optimise for learning surface area, not shipping velocity"), and hand-rolling these hooks *is* the learning. It recorded three "Revisit when" triggers: (1) recurring staleness / duplicate-fetch / manual-invalidation pain; (2) the app **outgrowing the learning-vehicle framing** — "e.g. it moves toward production use, or the server-state mechanics are no longer the thing being learned"; (3) hand-written optimistic-rollback plumbing becoming a maintenance liability.

The premise has now changed at the source. Trigger 2 has fired directly and deliberately:

- **The project goals were refocused from learning vehicle to productionisation** (`docs/goals.md`, commit `8ed8da9`). ADR 0010's entire rationale — "a library removes exactly the learning this project exists to capture" — rests on the learning-vehicle framing that the project has now consciously left. With shipping velocity and maintainability now in scope, the objection that carried 0010 no longer applies.

Triggers 2 (second clause) and 3 reinforce it:

- **The mechanics are already learned.** Server state has been hand-rolled across Phases 1–19: fetch/loading/error lifecycle (`useNotes` + ~7 sibling reads), optimistic-update-with-rollback on every mutation (notes, folders, todos, actions, tags, meetings, calendar-link), manual cache invalidation (`App.tsx` re-fetches `getFolders`/`getNoteCards` after mutations), and the out-of-order-response / `ignore`-flag race fix (slice 19-E). Continued hand-rolling is now repetition, not new learning.
- **The plumbing is now the cost.** Every mutation re-implements apply-then-reconcile by hand, and `App.tsx` carries manual `getX().then(setX)` invalidation (flagged in the Phase 19 frontend audit) — the exact boilerplate a library removes, now a maintenance liability as the app productionises.

Two enabling facts also changed since 0010: slice **19-A** split `api.ts` into per-domain modules, giving a clean seam for `useQuery`/`useMutation` wrappers; and a throwaway spike (2026-06-05) migrated `TodoSection` to TanStack Query 1:1 — `tsc`/build green, all 19 component tests passing — confirming behaviour-equivalence and surfacing the real costs (a root provider, a per-domain hooks file, a `QueryClientProvider` wrapper in ~24 test files, ~13 kB gzipped, and per-item pending tracking).

## Decision

**Adopt TanStack Query for server state, reversing [ADR 0010](0010-server-state-strategy.md).** Migrate **incrementally, one domain per slice**, with hand-rolled and library code coexisting until the final slice, per **[Phase 20](../phases/phase-20.md)**.

The reversal follows the goals pivot: 0010 weighted "it hides the learning" highest and chose hand-rolled; under a productionisation goal that weight is gone, so the capability ranking decides. **Local UI state stays `useState`;** this decision covers only server (cached, server-owned) state.

### Options re-weighed

Same field as 0010 — **TanStack Query** vs **SWR** vs **hand-rolled**. The 0010 capability analysis stands (TanStack Query is the most complete: query cache, dedup, retry, stale-while-revalidate, first-class optimistic mutations with rollback). Only the weighting changed. **TanStack Query** is chosen.

## Consequences

- A new frontend dependency (`@tanstack/react-query`, ~13 kB gz). The dependency-minimalism point in 0010 is consciously traded for the boilerplate reduction.
- Each read becomes a `useQuery` over the 19-A `api/<domain>.ts` functions; each mutation a `useMutation` with `onMutate`/`onError` rollback — CLAUDE.md's optimistic-UI rule is **satisfied by the library's machinery, not removed**.
- The `App.tsx` manual invalidation sprawl is deleted; cross-view sync becomes `invalidateQueries`.
- Component tests need a `QueryClientProvider` wrapper (a shared test helper) — a one-time harness change across ~24 files.
- Phase 19's **19-H** (network retry/backoff) is **subsumed** — configured once in `QueryClient` defaults; do not run it separately.
- Transcription credentials stay hand-rolled (one-shot short-lived STS creds, not cacheable server state).
- Migration is incremental and reversible per slice; a regression in one domain leaves the others (hand-rolled or already migrated) working.

## Revisit when

Unlikely to need reversing, but: if the dependency's upgrade/maintenance burden or bundle cost ever outweighs the boilerplate it removes, or React's own data primitives (`use`, Server Components under a future SSR move) make it redundant — re-open here.
