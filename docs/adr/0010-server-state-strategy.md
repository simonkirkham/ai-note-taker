# ADR 0010 — Server-state strategy: stay hand-rolled (defer TanStack Query / SWR)

**Status:** Superseded by [ADR 0012](0012-adopt-tanstack-query-server-state.md) (2026-06-05)

**Date:** 2026-06-03

## Context

The frontend manages a meaningful amount of *server state* — cached, client-side copies of data the server owns: notes, folders, action items. Today each feature hand-rolls this with a `useEffect`-fetch + `useState` custom hook (`useNotes` and siblings) that re-solves the same concerns every time: issue the request, track `loading`/`error`, expose the data. Most of these hooks skip the harder parts entirely — caching across views, request de-duplication, retry, and stale-while-revalidate.

Mature server-state libraries — **TanStack Query** (a.k.a. React Query) and **SWR** — exist precisely to remove this boilerplate. They provide a normalised cache keyed by query, automatic request de-duplication, retry/backoff, background refetch and stale-while-revalidate, and built-in **optimistic-update-with-rollback** — the exact pattern this project already mandates for every mutation (see the "Optimistic UI updates" rule in [CLAUDE.md](../../CLAUDE.md)). Adopting one would let the app delete a category of hand-written plumbing and get those guarantees for free.

The standards docs have so far been *silent* on this choice, which reads as unconsidered rather than deliberate. The point of this ADR is to replace that silence with a recorded decision so future contributors do not re-litigate it.

## Decision

**Defer adopting a server-state library. Keep the current hand-rolled `useEffect`-fetch + `useState` custom hooks (e.g. `useNotes`) for now.**

This is a conscious "not yet", not an oversight. We are **not** adding TanStack Query, SWR, or any equivalent dependency in this slice, and we are **not** rewriting any existing data hook.

The crux of the decision is the project's purpose. This repo is explicitly a **learning vehicle** (see [docs/goals.md](../goals.md)): *"optimise for learning surface area, not shipping velocity."* Hand-rolling these hooks teaches the server-state mechanics — fetch lifecycle, loading/error modelling, cache invalidation, and optimistic-update-with-rollback wiring — that a library would hide behind its API. A library that does all of this for you removes exactly the learning this project exists to capture, which cuts directly against its reason for being. The existing hooks work today, and the app is small enough that the costs the library would mitigate (staleness, duplicate fetches) are not yet biting.

### Options weighed

- **TanStack Query (React Query)** — the most capable option: query cache, de-dup, retry, background refetch, stale-while-revalidate, first-class optimistic mutations with rollback. Largest dependency and the most concepts to learn *as a consumer of the library* rather than as the author of the mechanics. **Rejected for now** — it hides the very mechanics we want to learn by building.
- **SWR** — lighter than TanStack Query, covers caching/dedup/revalidation, weaker built-in mutation/optimistic story. Same fundamental objection: it abstracts away the learning. **Rejected for now.**
- **Hand-rolled `useEffect` + `useState` hooks (status quo)** — re-solves fetch/loading/error per feature and skips caching/dedup/retry, but maximises learning surface and keeps the dependency surface minimal. **Chosen.**

## Consequences

- Hand-rolled hooks will continue to re-solve the same server-state problems per feature, and may carry subtle staleness or duplicate-fetch bugs as the app grows. We accept this as the cost of the learning.
- Optimistic updates stay **manually wired**, hook by hook, per the optimistic-update rule in [CLAUDE.md](../../CLAUDE.md). The library would have supplied rollback for free; without it, every mutation handler must apply-then-reconcile by hand, and new handlers must mirror the optimistic-first pattern of the nearest existing handler.
- No new frontend dependency is added; the dependency surface stays small.
- The decision is now recorded, so future contributors do not silently re-open it — disagreement should take the form of revisiting this ADR with the "Revisit when" triggers below, not an ad-hoc library addition.

## Revisit when

Re-open this decision — and, if reversed, adopt **TanStack Query** as a new numbered phase with incremental hook-by-hook migration (a migration, not a big-bang rewrite) — when **any** of the following holds:

- the hand-rolled hooks start causing **real, recurring pain** — stale data across views, duplicate fetches on the same endpoint, or messy/manual cache invalidation that is error-prone to get right;
- the app **outgrows the learning-vehicle framing** (e.g. it moves toward production use, or the server-state mechanics are no longer the thing being learned);
- the volume of hand-written optimistic-update-with-rollback plumbing becomes a meaningful maintenance or correctness liability.

At that point the migration graduates to its own numbered phase per the standing-doc lifecycle; this ADR is superseded rather than edited.
