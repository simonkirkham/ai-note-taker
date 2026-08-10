# Agent Git Workflow — Bitbucket

You are working on a Bitbucket repository. Follow these rules strictly.

## Branching

- Create a new branch from the latest `main` before starting any task.
- Branch name format: `agent/<task-id>-<short-description>`
- Never commit directly to `main`.

## Committing & Pushing

- Commit and push at logical checkpoints, at minimum every 2 hours.
- Pre-push hooks will run validation — do not bypass them.
- If pre-push hooks fail, fix the issues before pushing.

## Merge Conflicts

- Before opening a PR, rebase your branch onto the latest `main`.
- If conflicts exist, you are responsible for resolving them — this applies if you are the most recent agent to push to your branch.
- After resolving, re-run validation before proceeding.

## Pull Requests

- Open a PR to merge into `main` once your task is complete and your branch is up to date with `main`.
- You may open a PR at any time, but do not merge it if the `main` pipeline is currently running or in a failed state. Wait until `main` is green and your PR pipeline has passed before merging.
- The PR pipeline must pass fully before merging.
- Do not merge manually — wait for pipeline confirmation.

## Post-Merge

- After your PR merges, monitor the `main` pipeline.
- Do not begin new work or open new PRs until the `main` pipeline passes.
- If the `main` pipeline fails after your merge, treat fixing it as your current task.

## Blocked States

- Never wait indefinitely. Take a concrete unblock step first, then **ask a peer** (`ListAgents` → `SendMessage`) — whose branch is this, is the failure known, is this conflict safe to resolve my way. Keep working while you wait.
- The human is the **last resort**, reached only when no peer can answer and the question is genuinely theirs. See `agent-roles.md` → `## Blocked states` and `CLAUDE.md` → `### When NOT to hand back`.
