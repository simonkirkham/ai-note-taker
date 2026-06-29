# Phase 20-A — TanStack Query foundation + todos pilot

Slice that sets the template every later Phase 20 slice copies. PR #184.

## The keystone decision: when to add `onSettled: invalidateQueries`

The phase doc's Appendix-A template shows mutations ending with
`onSettled: () => qc.invalidateQueries(...)`. The shipped todo mutations **omit** it.
This is deliberate and documented in `web/src/hooks/useTodoMutations.ts`.

| Domain shape | Rule | Why |
|---|---|---|
| **Single consumer** of a query key (todos today) | **Omit** `onSettled` invalidate | The optimistic result already equals what the server echoes back, so a reconciling refetch is pure churn. The hand-rolled version never refetched either — behaviour is preserved. |
| **Multiple consumers** (folders, note cards, note detail) | **Add** `onSettled: () => qc.invalidateQueries({ queryKey: keys.<domain> })` | Cross-view sync is the entire point of ADR 0012 — a mutation in one view must make every other view re-read. This is the `App.tsx` manual-refetch sprawl the phase deletes. |

**Second reason to omit when you can:** adding live `invalidateQueries` refires the GET
against the component test's MSW handler. Most existing component tests use **static**
MSW handlers that return a fixed list — so a refetch re-serves the pre-mutation data and
can resurrect an optimistically-deleted row. A slice that adds `onSettled` invalidate
must also give that domain's tests mutation-aware handlers (or assert the post-refetch
state explicitly). Budget for it; don't bolt invalidate on and assume green.

## Per-item busy is local state, not `mutation.isPending`

`useMutation().isPending` is per-hook, not per-row. The pre-existing `busy: Set<string>`
local state was kept, with handlers bridging `mutateAsync` + `try/finally`. Don't try to
derive per-row disable from the mutation object — it disables every row at once.

## QueryClient defaults

`retry: 1`, `staleTime: 30_000`, `refetchOnWindowFocus: false`, mutations `retry: false`.
`apiFetch` already does 401/token refresh, so query retry stays low; no-focus-refetch and
a modest staleTime pre-empt the refetch-storm risk flagged in the phase Observability section.

## Provider nesting

`QueryClientProvider` sits **outside** `AuthProvider` (`main.tsx`). Safe because query fns
read the module-level token store, not React context, and `apiFetch` has a 401 fallback —
no provider-ordering/auth-token race (the project has a history of those; comment added so
nobody "fixes" the nesting).

## Test seam

`web/src/test/render.tsx` re-exports RTL + a `render` that wraps in a fresh per-test
`QueryClient` (`retry: false`). Every component (or subtree, e.g. `ListView → TodoSection`)
that reads server state imports `render` from there instead of `@testing-library/react`.
Later slices: just keep using this helper; it already isolates the cache per test.
