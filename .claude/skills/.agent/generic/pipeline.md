# Pipeline Reference — Principles

## Checking Pipeline Status

Each repo should provide a command to check pipeline status — check the repo-specific pipeline docs for the exact command. Use it to determine the current state of `main` before opening or merging a PR.

## Pipeline States

| State         | Meaning            | Action                                       |
| ------------- | ------------------ | -------------------------------------------- |
| `SUCCESSFUL`  | All steps passed   | Safe to open PRs / merge                     |
| `IN_PROGRESS` | Currently running  | Wait before merging                          |
| `FAILED`      | A step failed      | Do not merge; investigate                    |
| `STOPPED`     | Manually cancelled | Treat as inconclusive; re-run or investigate |

## Merge Rules

- Do not merge a PR if the `main` pipeline is `IN_PROGRESS` or `FAILED`
- Your PR pipeline must pass fully before merging
- Do not merge manually — wait for pipeline confirmation

## When Main Is Red

1. Check the pipeline to identify the failing step
2. Do not open new PRs or merge until `main` is green
3. If your recent merge caused the failure, fixing it is your current task
4. If `main` was already red before your work, flag to a human before proceeding

## PR vs Main Pipelines

Most pipelines run a subset of steps on PRs (e.g. validate only, no deploy). A passing PR pipeline does not guarantee the full main pipeline will pass — be aware of what your PR pipeline actually covers.
