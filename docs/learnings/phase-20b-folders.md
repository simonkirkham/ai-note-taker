# Phase 20-B — Folder-tree TanStack Query migration

Migrated the folder *tree* domain (`getFolders` + create/rename/delete/move) to TanStack Query. PR #187.

## The dominant cost was running Phase 20 concurrently with Phases 21 & 22 — all editing `App.tsx`

20-B took ~360k (≈2× 20-A) almost entirely because, mid-build, **21-A (React Router) merged to main, then 22-A + BUG-12 merged**, and 21-A rewrote `App.tsx`'s navigation (replaced the `view` state machine with `navigate`). The folder logic never conflicted — but `App.tsx` did, forcing **two rebases** and a full re-verify each.

**Rule (extends CLAUDE.md's "same-file → don't parallelise" from slices to *phases*):** Phase 20 (server-state, edits `App.tsx`), Phase 21 (routing, rewrites `App.tsx`), and Phase 22 (search, adds to `App.tsx`) are the *same-file anti-pattern at phase scale*. The orchestrator must **sequence phases that all edit `App.tsx`**, not run them in parallel — the wall-clock saving is illusory and the rebase/re-verify tax is large. If they must overlap, land the structural one (routing) first and branch the others off it.

## `git rebase --quit` left the branch ref behind → stale PR head

While resolving the 21-A rebase, the `rebase --continue` machinery got stuck (no unmerged entries, yet it refused). I committed the resolved index with `git commit` (HEAD was detached at the rebase tip) then ran **`git rebase --quit`**. `--quit` abandons the rebase **without moving the branch ref** — so `slice/20-b-folders` stayed at the old pre-rebase commit while the good commit sat on a **detached HEAD**. The subsequent push + PR captured the *stale* commit (wrong base, missing the Hawk fix); only `gh pr view --json headRefOid` caught it.

**Fix / rule:** never finish a resolved rebase with `--quit`. If `--continue` is stuck, re-point the branch explicitly: `git checkout -B <branch> <good-sha>`, then `git push --force-with-lease`. Always verify `gh pr view <n> --json headRefOid` equals your local HEAD after any force-push or rebase recovery.

## Optimistic move can orphan a subtree — guard self/descendant drops

Making folder-move optimistic (per the optimistic-UI rule) newly *exposed* a latent gap: `onMutate` does `removeFromTree(node)` then `insertIntoTree(parent)`. For a drop onto **self or the node's own descendant**, the parent is inside the just-removed subtree → insert finds nothing → the folder **vanishes** until the refetch. The backend has no cycle guard, so the refetch wouldn't recover. Guarded in both `App.handleMoveFolder` (skips the bad API call entirely, using the full tree) and `useMoveFolder.onMutate` (no-op transform, defense-in-depth). Pessimistic mutations masked this; optimism surfaces it — audit every newly-optimistic mutation for "what does the transform do with an invalid target".

## `onSettled: invalidateQueries` here, unlike 20-A

20-A todos omit `onSettled` (single consumer, optimistic == server). 20-B **adds** it: `createFolder` returns a server id the optimistic `temp-…` id must be swapped for, and only a refetch knows the real id. (The "multiple readers" justification is currently aspirational — `useFolders` has one consumer; the others get props. The temp-id reason is the one that holds today; see [[phase-20a-tanstack-foundation-todos]].)

## Test pitfalls this slice surfaced

1. **Async rollback needs `waitFor`.** Rollback runs in `onError` (a microtask after the API rejects), so a *synchronous* assertion right after `act(resolveReject)` races it — passed under the `forks` pool, failed under `threads` (and CI/hook use threads). Wrap rollback assertions in `waitFor`. Optimistic-apply assertions after `userEvent.*` are fine (userEvent awaits enough).
2. **`onSettled` refetch reverts the optimistic value unless the MSW GET returns the post-mutation tree.** A rename test whose GET keeps returning the old name will see the refetch overwrite the optimistic rename. Update the GET handler (or make it stateful) to reflect the mutation.
3. **When optimistic and server objects share a display string, assert on the id.** The create test's temp and real folders are both "People"; `findByText('People')` flaked. Assert `findByTestId('folder-name-<realId>')` to prove the temp→real swap deterministically.
4. **Drag-drop is fragile in jsdom** — test the move's optimistic transform at the hook level (`renderHook` + a seeded `QueryClient`) instead of simulating a UI drag.
