# Workspace switch stuck on "Loading…" — removeQueries evicted in-flight queries

**Context:** user-reported live bug after Phase 23-E. Switching workspaces left every section stuck on "Loading…" despite **all HTTP calls returning 200**. Fixed in PR #239.

## Root cause

`WorkspaceProvider` evicted the cache on every switch:

```ts
qc.removeQueries({ predicate: (q) => q.queryKey[0] !== "workspaces" });
```

The predicate matched by query **name**, not workspace id. On a switch A→B:

1. `setWorkspaceId(B)` runs synchronously during render; children mount observers for `["noteCards", B]` etc. and fire fetches.
2. The post-commit effect then `removeQueries` — deleting those **brand-new B queries (and the global `["meetings", date]`) mid-fetch**.
3. The observers are left in `pending`/`idle` — loading forever — even though the requests resolve 200. (The double-fetch in the network tab was the symptom: original fetch + the post-removal refetch.)

## Why the eviction was never needed

Query keys already fold in the workspace id (`["todos", getWorkspaceId()]`, `queryKeys.ts`). Each workspace has its own cache bucket, so switching to B uses *different keys* — workspace A's data can never render under B. The `removeQueries` was redundant isolation on top of key-based isolation, and the by-name predicate made it actively destructive. **Fix: delete the eviction entirely.** Inactive old-workspace caches are GC'd by TanStack's default `gcTime` (5 min).

## Takeaways

1. **Don't `removeQueries` on active, in-flight queries** — it strands observers in `pending`. Prefer `invalidateQueries`/`resetQueries`, or nothing when keys already isolate.
2. **If cache keys already encode the dimension you're switching on, you don't need to evict on switch** — the new keys fetch fresh and the old ones are inert.
3. **"All requests 200 but UI stuck loading" ⇒ observer/query-key mismatch**, not a network problem. Look for cache eviction or key churn between observe-time and resolve-time.
4. A by-`queryKey[0]` predicate is a smell — it ignores every later key segment (here, the workspace id that distinguishes new from old).
