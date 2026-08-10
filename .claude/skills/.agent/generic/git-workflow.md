# Git Workflow — GitHub

`CLAUDE.md` is canonical for all of this. Sections `## Worktrees`, `## Workflow` and `## Guardrails` win on any conflict; this file is the short git-specific view.

Remote is **GitHub**, driven with the `gh` CLI. There is no Bitbucket, no rebase-before-PR step, and no auto-merge-on-green.

## Branching

| Rule | Detail |
| --- | --- |
| One worktree per slice | `git worktree add ../ai-note-taker-slices/<slice-name> -b slice/<phase>-<id>-<desc>` — use an **absolute** path; a relative one nests the worktree inside the repo when cwd is a subdirectory |
| Branch name | `slice/<phase>-<id>-<short-description>`, e.g. `slice/43-c-agenda-field` |
| Who creates it | Breaker, before the first test commit |
| Never | commit slice work directly to `main` |
| Parallel slices are normal | independent slices run concurrently in their own worktrees — see `run-pipeline` for what may and may not parallelise |

First-time setup in a fresh worktree: `dotnet restore ai-note-taker.sln`, `npm --prefix web install`, and publish all three Lambdas (`Api`, `Projector`, `TranscribeCompletion`) so the pre-commit `cdk synth` can find its assets.

## Committing

- The gate is a **pre-commit** hook (`.githooks/pre-commit`), not pre-push. It needs `git config core.hooksPath .githooks` **once per clone** — a clone that never ran it is silently unprotected.
- The hook is scoped to what is staged: docs-only commits skip the build/test gate; `cdk synth` runs only for infra-affecting paths.
- **A commit staging `src/`, `tests/` or `web/` runs the full suite — run it with `run_in_background`.** A foreground `git commit` gets killed by the command timeout and leaves the change staged but uncommitted.
- **Never `--no-verify`.** A missing build artefact is a setup gap to fix, not a check to skip.
- Commit in small working increments: backend before frontend, one endpoint/component/utility at a time.

## Updating a branch

- **Merge, don't rebase:** `git merge origin/main` inside the worktree, resolve, re-run the gate, push.
- The three tracking tables carry `merge=union` in `.gitattributes`, so concurrent *appends* resolve automatically. Union's bad case is two branches editing the **same row** — `scripts/check-doc-ids.sh` catches it (pre-commit hook + `docs-check.yml`).

## Pull requests

- Open with `gh pr create --body-file .pr-body.md` — never a shell variable holding a multiline body.
- Hawk reviews the moment the PR opens, in parallel with CI. Do not wait for CI to start the review.
- **Pip merges by hand after the gate is green** — `gh pr merge --squash --delete-branch`. `--auto` does **not** hold the merge here (no required-status-check branch protection), so it merges immediately; verify the gates yourself.
- The gate is `scripts/merge-gate.sh <pr>` (exit 0 = safe). See [`pipeline.md`](./pipeline.md).
- Tell peers before merging: `merging <PR> now, deploy will run`.

## Post-merge

1. `git worktree remove ../ai-note-taker-slices/<slice-name>`
2. `git branch -D slice/<phase>-<id>-<desc>` — `--delete-branch` removes only the **remote** branch; its local cleanup fails with `'main' is already used by worktree`, which is harmless.
3. Poll the main deploy (`scripts/deploy-status.sh`) until it reaches a terminal state.
4. Deploy green → Scribe. Deploy red → `scripts/ci-logs.sh`, fix, push.

## Committing on `main`

- **Doc edits to `main` are committed in the same turn they are made.** A modified-but-uncommitted doc on main is invisible to every parallel session and lost on the next worktree operation.
- **Stage by explicit path — never `git add -A` or `git add .`.** A Scribe run once committed a near-empty tree and mass-deleted `main` (−1056 files). Before any push to `main`, confirm `git diff --cached --stat` lists only the intended files and `git ls-tree -r HEAD | wc -l` is in the expected thousands.
- The main checkout may carry the human's in-flight WIP. Leave it alone; stage only your own files.
- If the primary checkout is dirty or its `main` has diverged from `origin/main`, work from a fresh worktree off `origin/main` and `git push origin HEAD:main`.

## Blocked states

Being blocked is a call to **action**, not to escalate.

1. Take a concrete unblock step. A red shared gate is yours to drive green whoever caused it.
2. **Ask a peer** — `ListAgents` → `SendMessage` — and keep working while you wait. Whose branch is this, is the failure known, is this conflict safe to resolve my way: all peer questions.
3. Peer idle or slow → take the reversible option, state the assumption under `YOU SHOULD KNOW`, carry on. `scripts/sessions.sh` reconstructs who is on what.
4. The human is the **last resort**, reached only once the approach is agreed and no peer can answer — their taste, their priorities, their money, or an irreversible act you would recommend. See `agent-roles.md` → `## Blocked states` and `CLAUDE.md` → `### When NOT to hand back`.

Never bypass a failing hook or CI gate.
