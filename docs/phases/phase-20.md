# Phase 20 — Server-state migration to TanStack Query

**Goal:** Replace the hand-rolled `useEffect`-fetch + `useState` server-state hooks with **TanStack Query** — normalised query cache, request dedup, retry/backoff, stale-while-revalidate, and built-in optimistic-update-with-rollback — migrating **incrementally, one domain per slice**, with hand-rolled and TanStack coexisting until the last slice. This **reverses [ADR 0010](../adr/0010-server-state-strategy.md)** (Accepted: *stay hand-rolled*), so it is **hard-gated** on a superseding ADR. Builds on the clean `api/<domain>.ts` seam from slice 19-A.

## Summary

| Slice | Summary | Status | Depends on |
|-------|---------|--------|------------|
| Gate | **Supersede ADR 0010** with a new ADR recording the trigger that justifies reversal. No code. | Done | — |
| 20-A | **Foundation + todos pilot.** `QueryClientProvider`, query-key factory, `QueryClient` defaults, devtools; migrate `TodoSection` (`getTodos` + complete/reopen/delete/add) as the reference template for every later slice. | Not Started | Gate |
| 20-B | **Folders.** `getFolders` + 6 folder mutations; delete the `App.tsx` `getFolders().then(setFolders)` invalidation sprawl. | Not Started | 20-A |
| 20-C | **Note cards / list.** `getNoteCards` + `useNotes` (create/rename/delete). | Not Started | 20-A, 20-B |
| 20-D | **Actions + tags.** `getActions`/`getTags` + their mutations + `useTagSuggestions`. | Not Started | 20-A |
| 20-E | **Note detail.** `getNoteDetail` + `editContent`/`setNoteDate`/`analyseNote` refetch (NoteView has the most mutations). | Not Started | 20-A |
| 20-F | **Meetings.** `getMeetingsForDate` + create-from-meeting / next-occurrence / link; preserve Phase 16's reminders-vs-browsed-day decoupling. | Not Started | 20-A |
| 20-G | **Cleanup.** Remove dead hand-rolled hooks + remaining manual invalidation; fold retry/backoff into `QueryClient` defaults (subsumes Phase 19's 19-H); learnings. | Not Started | 20-B…20-F |

> **The whole phase is gated on the ADR** — do not start 20-A until ADR 0010 is superseded. **20-A is the keystone**: it sets the conventions (key factory, optimistic `onMutate`/rollback template, retry/error defaults) every later slice copies — get it right before fanning out. 20-B…20-F are independent *domains* and could parallelise after 20-A, **except** 20-B and 20-C both edit `App.tsx`, so sequence those (per the "same-file → don't parallelise" rule). **Subsumes 19-H** — don't also run it. **Transcription credentials stay hand-rolled** (short-lived STS creds fetched once before streaming aren't cacheable server state).

**Learning surface:** a server-state library's cache/dedup/invalidation model vs hand-rolled effects; query keys and cache granularity; `useMutation` optimistic-update-with-rollback (`onMutate`/`onError`/`onSettled`) replacing manual try/catch reverts; `invalidateQueries` replacing cross-view manual refetch; incremental migration with two systems coexisting; the dependency/bundle tradeoff the ADR weighed.

---

## Slices

Each migrates one domain: add `useQuery`/`useMutation` hooks over the existing `api/<domain>.ts` functions, swap the component onto them, and delete that domain's hand-rolled read effect + manual optimistic handlers. Every slice ships green with the rest of the app still hand-rolled. The optimistic-UI rule (CLAUDE.md) is satisfied by `onMutate`/rollback — surface failures the same as today.

- **Gate — supersede ADR 0010.** New ADR: context (the trigger — recurring staleness / duplicate fetches, outgrowing the learning-vehicle framing, or rollback plumbing becoming a liability), decision (adopt TanStack Query, incremental), consequences. Supersedes, does not edit, 0010.
- **20-A — Foundation + todos pilot.** Root `QueryClientProvider` (above/around `AuthProvider`); `api/queryKeys.ts` factory; `QueryClient` defaults (staleTime, retry — low, since `apiFetch` already handles auth refresh); `@tanstack/react-query-devtools` (dev-only). Migrate `TodoSection` as the worked template (Appendix A). **Install on Node 20 to match CI** before committing `package-lock.json`.
- **20-B — Folders.** Biggest manual-invalidation payoff.
- **20-C — Note cards / list.** After 20-B (shares `App.tsx`).
- **20-D — Actions + tags.**
- **20-E — Note detail.** Largest mutation surface.
- **20-F — Meetings.** Watch the reminders/browsed-day split.
- **20-G — Cleanup.** Delete dead code; retry/backoff via `QueryClient` defaults; remove `App.tsx` manual refetch entirely.

---

## Slice 20-A — Foundation + todos pilot

**Status:** Not Started

**User value:** None directly (infrastructure + a like-for-like migration of one domain). Establishes the TanStack template the rest of Phase 20 copies. Behaviour for todos is unchanged — proven by the existing `TodoSection` suite staying green.

### Scenarios

```
Scenario: Todos load and render unchanged
  Given the todos endpoint returns open and completed items
  When the home screen renders TodoSection
  Then the open and Done lists appear exactly as before the migration

Scenario: Completing a todo is optimistic and rolls back on failure
  Given an open todo
  When I complete it and the request fails
  Then it shows completed immediately, then reverts to open
  And the failure is surfaced as it is today (no silent rollback)

Scenario: Adding a todo updates the shared cache optimistically
  Given the add input
  When I submit a new to-do
  Then it appears immediately and its temp id is swapped for the server id on success
  And it is removed if the create fails
```

### Acceptance criteria

- [ ] `@tanstack/react-query` added to `web/package.json`; `package-lock.json` generated on **Node 20** so `npm ci` is green in CI
- [ ] `QueryClientProvider` wraps the app at the root (`main.tsx`); a single `QueryClient` with sane defaults (low/again-off retry — `apiFetch` already handles auth refresh)
- [ ] `web/src/api/queryKeys.ts` key factory added (`todos`, plus the keys later slices will use)
- [ ] `TodoSection` reads via `useTodos` (`useQuery`) and mutates via `useCompleteTodo`/`useReopenTodo`/`useDeleteTodo` (`useMutation`, `onMutate` optimistic + `onError` rollback); the add flow writes the cache via `setQueryData`; **per-item busy preserved**
- [ ] No hand-rolled `getTodos` `useEffect` remains in `TodoSection`
- [ ] Optimistic-UI rule satisfied — apply immediately, roll back **and surface** the failure on error
- [ ] Component tests render through a `QueryClientProvider` (shared/local helper); full Vitest suite + `tsc -b`/build + ESLint green
- [ ] Only the todos domain migrated; folders/notes/actions/tags/meetings remain hand-rolled (coexistence intact)

---

## Appendix A — What one domain migration looks like (todos)

The concrete shape, using `TodoSection` (the 20-A pilot). Three new files, one slimmed component.

### New: `api/queryKeys.ts` (created once in 20-A)

```ts
export const keys = {
  todos: ["todos"] as const,
  folders: ["folders"] as const,
  noteCards: ["noteCards"] as const,
  tags: ["tags"] as const,
  note: (id: string) => ["note", id] as const,
  actions: (noteId: string) => ["actions", noteId] as const,
} as const;
```

### New: `hooks/useTodos.ts` — the read (replaces the `useEffect` + `useState` + `cancelled` guard)

```ts
import { useQuery } from "@tanstack/react-query";
import { getTodos } from "../api/todos";
import { keys } from "../api/queryKeys";

export function useTodos() {
  return useQuery({ queryKey: keys.todos, queryFn: getTodos });
}
```

### New: `hooks/useTodoMutations.ts` — one mutation (replaces a manual optimistic handler)

```ts
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { completeTodo } from "../api/todos";
import { completeAction } from "../api/actions";
import { keys } from "../api/queryKeys";
import type { TodoItem } from "../api/todos";

export function useCompleteTodo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (item: TodoItem) =>
      item.type === "action"
        ? completeAction(item.noteId!, item.itemId)
        : completeTodo(item.itemId),
    onMutate: async (item) => {                              // optimistic
      await qc.cancelQueries({ queryKey: keys.todos });
      const previous = qc.getQueryData<TodoItem[]>(keys.todos);
      const completedAt = new Date().toISOString();
      qc.setQueryData<TodoItem[]>(keys.todos, (old) =>
        old?.map((i) => (i.itemId === item.itemId ? { ...i, completedAt } : i)));
      return { previous };
    },
    onError: (_e, _item, ctx) => {                           // rollback
      if (ctx?.previous) qc.setQueryData(keys.todos, ctx.previous);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: keys.todos }), // reconcile
  });
}
```

### Changed: `TodoSection.tsx` — before vs after

**Before** (hand-rolled — the read + one mutation):

```ts
const [items, setItems] = useState<TodoItem[]>([]);
const [loading, setLoading] = useState(true);
const [busy, setBusy] = useState<Set<string>>(new Set());

useEffect(() => {
  let cancelled = false;
  getTodos()
    .then((data) => { if (!cancelled) { setItems(data); setLoading(false); } })
    .catch(() => { if (!cancelled) setLoading(false); });
  return () => { cancelled = true; };
}, []);

async function handleComplete(item: TodoItem) {
  if (busy.has(item.itemId)) return;
  addBusy(item.itemId);
  const completedAt = new Date().toISOString();
  setItems((prev) => prev.map((i) => i.itemId === item.itemId ? { ...i, completedAt } : i));
  try {
    if (item.type === "action") await completeAction(item.noteId!, item.itemId);
    else await completeTodo(item.itemId);
  } catch {
    setItems((prev) => prev.map((i) => i.itemId === item.itemId ? { ...i, completedAt: null } : i));
  } finally {
    removeBusy(item.itemId);
  }
}
```

**After** (TanStack):

```ts
const { data: items = [], isLoading: loading } = useTodos();
const complete = useCompleteTodo();
// onChange={() => complete.mutate(item)}
```

### What actually changes, per domain

| Concern | Before | After |
|---|---|---|
| Read | `useEffect` + `useState` + `cancelled` guard, per component | `useQuery` one-liner; cache shared across views, dedup + stale-while-revalidate free |
| Optimistic update | manual `setItems(... map ...)` in the handler | `onMutate` snapshot + `setQueryData` |
| Rollback on error | manual `catch` reverting to a captured value | `onError` restores the `onMutate` snapshot |
| Cross-view sync | manual `getX().then(setX)` refetch (e.g. `App.tsx`) | `invalidateQueries` in `onSettled` — every view re-reads |
| `loading` flag | hand-tracked `useState` | `isLoading` from the hook |

**The one nuance to budget for:** per-item **busy** state. Today `busy: Set<string>` disables the specific row in flight; `useMutation.isPending` is per *hook*, not per item. Preserve it with `complete.isPending && complete.variables?.itemId === item.itemId`, or keep a small local in-flight set. Flag this in 20-A so the template covers it once.

---

## Out of scope

- **Transcription credentials** — one-shot short-lived STS creds, not cacheable server state; stay hand-rolled.
- **A SWR alternative** — the ADR reversal commits to TanStack Query specifically; don't re-litigate the library choice here.
- **Local UI state** (modals, inputs, view kind) — stays `useState`; this phase only moves *server* state.

---

## Observability

1. **Silent optimistic divergence.** The risk that survives the migration is the same as today's: an optimistic update that isn't rolled back on error, leaving the UI ahead of the server. Guard per slice with a component test that forces the mutation to reject and asserts the row reverts **and** the failure is surfaced (toast/`role="alert"`), exactly as the hand-rolled version must.
2. **Over-invalidation refetch storms.** `invalidateQueries` after every mutation can fan out into many refetches; if a slice invalidates broadly (e.g. `["note"]` for all notes on a single-note edit), watch the network panel and scope keys tightly.
3. **Coexistence drift.** While half the app is hand-rolled and half is TanStack, a mutation in one half won't invalidate the other's cache. Keep each domain wholly on one side per slice; 20-G removes the seam. Fold the `observability-brief` skill into each slice's spec when Breaker drafts it.
