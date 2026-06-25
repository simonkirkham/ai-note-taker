# Node 20 → 24 build upgrade (dep-audit T1)

PR #237, deploy #528, 2026-06-11. Bumped the frontend **build** Node 20 → 24 (CI `setup-node`), `@types/node ^20 → ^24`, regenerated the lockfile. Two non-obvious traps cost two extra CI rounds.

## 1. The lockfile/npm-version skew is bidirectional

**What happened:** Regenerated `package-lock.json` on local **npm 11.6.2** (Node v24.12.0). CI runs **npm 11.13.0**. The older local npm *pruned* the optional, peer `@emnapi/core` + `@emnapi/runtime` native-binding entries that CI's newer npm expects present → CI `npm ci` aborted with `Missing: @emnapi/core@… from lock file`.

**Why it's non-obvious:** The existing CLAUDE.md guardrail warns about the *forward* direction (lockfile cut on npm 11+/Node 24 omits entries Node 20's npm wants). This was the **reverse** — older local npm than CI. Same root cause (npm-version skew), opposite direction.

**Lesson — already applied to CLAUDE.md guardrail:**
- Match CI's npm version *exactly* before regenerating a lockfile, not just the Node major. `npm install -g npm@<CI-version>` then regenerate.
- `npm ci` passing **locally** only proves the lockfile against *your* npm. It is not evidence CI will pass unless your npm == CI's npm.

## 2. `@types/node@24` dropped a `lib` reference that hid a test-typecheck gap

**What happened:** `tsconfig.app.json` sets `lib: ["ES2020", …]` and excludes `__tests__`, so `tsc -b` passed. The **test** files use `Array.prototype.at()` (ES2022). `@types/node@20` transitively widened the available `lib` enough that `.at()` resolved; `@types/node@24` removed that, so CI's separate **`tsc -p tsconfig.test.json --noEmit`** step failed `TS2550`.

**Why it's non-obvious:** The `lib` was never explicit for the test config — it silently rode on `@types/node`'s transitive references. A `@types/node` major bump is not an obvious cause of an `Array.at()` "does not exist" error.

**Fix:** made `tsconfig.test.json`'s `lib` explicit (`["ES2022", "DOM", "DOM.Iterable"]`) so it no longer depends on `@types/node`'s transitive lib. Type-only; runtime unchanged.

**Lesson:** This is the BUG-15 guardrail again (CI typechecks tests via a *separate* `tsconfig.test.json`; `tsc -b`/app config does not cover them). I ran `tsc -b` + vitest but skipped `tsc -p tsconfig.test.json` — exactly the step the guardrail names. **When a dependency bump can affect types, run `tsc -p tsconfig.test.json --noEmit` locally, not just `tsc -b`.** Any `@types/*` major bump is "can affect types."

## 3. Operating notes (not new lessons, confirmed)

- **Parallel-work isolation worked:** built in a worktree off latest `origin/main`; `pull_request` CI uses each PR's own head-branch workflow, so bumping `pr.yml` to Node 24 did not retroactively break in-flight Phase 19 PRs. 19-F3 (jsx-a11y) merged mid-run → standard `git merge origin/main` + conflict resolution on `technical-improvements.md`.
- **`TagsJourney` E2E flake** blocked the merge gate once (an *unrelated* Phase 23 deploy, #527, failed `RemoveTag_PillDisappears` on a 30s timeout). Cleared by `gh run rerun --failed`, per the documented remedy. See the standing "Stabilise the flaky `TagsJourney` E2E" item.
