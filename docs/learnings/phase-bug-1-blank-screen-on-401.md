# Learnings: BUG-1 — Blank screen on 401

- The `&& token` guard added in slice 11-G (skip `triggerUnauthorized` when the request carried no token) was the proximate cause of BUG-1: it traded a spurious-logout symptom for a silently-swallowed-401 symptom. The real defect was upstream — the in-memory token wasn't seeded synchronously, so cold-load fetches went out unauthenticated. **Action:** fix the root cause (synchronous seed) *and* remove the band-aid guard, rather than adding another guard on top — Done (see `AuthContext.tsx` lazy initialiser + `api.ts` 401 path).
- A `git worktree add` with a relative `../` path nested the worktree inside the repo because the shell cwd was `web/`, not the repo root. Had to remove and recreate. **Action:** require an absolute path for `git worktree add` and document the cwd trap in CLAUDE.md Worktrees — Done.
- `gh pr merge --squash --delete-branch` reported a `git` error (`'main' is already used by worktree`) even though the merge succeeded — the failure was only the local branch-cleanup step, because main is checked out in the primary worktree. **Action:** document that this error is harmless and local cleanup is done separately in workflow step 13 — Done (CLAUDE.md step 11).
- Main advanced ~10 commits (incl. overlapping `web/src/api.ts`, `App.tsx`) while the slice was in flight; merging blind risked a red main. Merging `origin/main` into the branch and re-running the suite (206 green) validated the combined state before landing. **Action:** for any slice that sits open while main moves on overlapping files, merge latest main into the branch and re-run tests before the squash-merge — TODO (consider adding to the merge step as standard practice).
- `npm run build` dirties the tracked `web/tsconfig.app.tsbuildinfo`, which had to be `git checkout --`'d before each commit to avoid build-artifact churn. **Action:** gitignore `*.tsbuildinfo` and `git rm --cached web/tsconfig.app.tsbuildinfo` in its own small commit — TODO (repo-wide tracking change; out of scope for a docs commit).
- The reported `content.js:360 ... kernel 'TopK' for backend 'webgl' is already registered` console warning is browser-extension noise (TensorFlow.js content script), not app code — the repo has zero TF.js/WebGL usage. **Action:** record the triage in `phase-bugs.md` rather than logging a defect we can't fix; reproduce in a clean profile to confirm — Done.

## Applied status

| Learning | Status |
|---|---|
| 1. Fix root cause + drop the band-aid guard | Applied — `AuthContext.tsx`, `api.ts` |
| 2. Absolute path for `git worktree add` | Applied — CLAUDE.md Worktrees note |
| 3. `--delete-branch` local-cleanup error is harmless | Applied — CLAUDE.md workflow step 11 |
| 4. Re-validate against advanced main before merge | TODO — practice followed this slice; not yet codified as a rule |
| 5. Gitignore `*.tsbuildinfo` | TODO — needs its own `git rm --cached` commit |
| 6. content.js/TopK is extension noise, not a bug | Applied — note in `phase-bugs.md` BUG-2 |
