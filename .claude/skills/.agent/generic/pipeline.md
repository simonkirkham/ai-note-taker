# Pipeline Reference — GitHub Actions

`CLAUDE.md` is canonical (`## Workflow`, `## Guardrails`, `## Helper scripts`). This file is the short CI-specific view.

## Checking status — use the helper scripts

| Question | Command | Verdict |
| --- | --- | --- |
| Is it safe to merge this PR? | `scripts/merge-gate.sh <pr>` | one `MERGE GATE: GREEN/BLOCKED` line; exit 0 = safe |
| Is main's deploy clear? | `scripts/deploy-status.sh` | `GREEN (#N) — safe to merge` / `IN PROGRESS` / `NOT SAFE`; exit 0 = safe |
| Why did it fail? | `scripts/ci-logs.sh [pr\|run-id]` | failed-step logs (no arg = main's latest deploy) |
| Are this PR's own checks green? | `gh pr checks <n>` | every check must read `pass` |

Never poll with the `Monitor` tool — it prompts for approval on every launch. Use a single `Bash` helper-script call or a `run_in_background` `until` loop.

## Run states

GitHub reports two fields, not one. Read **both**.

| `status` | `conclusion` | Meaning | Action |
| --- | --- | --- | --- |
| `completed` | `success` | Passed | Safe to merge |
| `queued` / `in_progress` | *(none yet)* | Running | **Wait it out** — never merge during a deploy |
| `completed` | `failure` | A job failed | Do not merge; diagnose |
| `completed` | `cancelled` | Superseded or cancelled | Inconclusive; re-run or investigate |

Two traps:

- **Never filter with `--status completed`** — it hides an in-progress run and reports a stale green.
- **A `--limit 1` snapshot is not enough.** A run that reached `completed success` can be **re-run**, flipping the same run back to `in_progress`. Require quiescence across `--limit 5`; if you have seen a run oscillate, wait for it to settle. (27-D merged on a momentary green mid-re-run.)

## Merge gates (both, hard)

1. **PR CI all green** — every check `pass`, none pending/failing/cancelled.
2. **Main deploy clear** — latest deploy run `completed` + `success`, none in progress.

A `CONFLICTING` branch runs **head-only** checks — the merge-result `backend`/`frontend`/`eventstore` checks never start — so `gh pr checks --watch` can exit 0 on a near-empty list. Confirm `gh pr view <n> --json mergeable,mergeStateStatus` is `MERGEABLE`/`CLEAN` first. `merge-gate.sh` checks all of this in one call.

## When main is red

A red shared gate blocks every slice and every parallel session. It is a call to **action**.

1. Diagnose it — `scripts/ci-logs.sh`. If it is your change, fix it.
2. If it is another slice's failure, **it is still yours to drive green**. Never park and wait for the owner.
3. Tell peers: `deploy #N red on <journey> — mine/not mine, diagnosing`.
4. Cannot fix it? Take a concrete unblock step anyway — re-run a *proven* flake, or quarantine with a filed high-priority bug as a last resort — **and** file the bug.
5. Re-running is legitimate only for a *genuine* flake. The same test failing on every attempt is a real bug — diagnose before you re-run.

Only stop for genuinely destructive or ambiguous calls (reverting someone's slice, masking a real bug). See [`docs/learnings/act-on-red-builds-dont-wait.md`](../../../../docs/learnings/act-on-red-builds-dont-wait.md).

## Which workflow runs what

| Workflow | Trigger | Jobs |
| --- | --- | --- |
| `pr.yml` | PR opened/updated | `backend`, `frontend`, `eventstore`, `desktop` |
| `docs-check.yml` (**"Repo Checks"**) | PR touching the tracking docs, `.github/workflows/**` or `.github/actions/**` | `doc-ids` (duplicate BUG/TI/CHANGE ids); `workflows` (actionlint + shellcheck — a workflow that does not parse fails HERE and nowhere else) |
| `deploy.yml` | **push to `main` only** | `detect-changes` → `validate-frontend` / `validate-backend` → `deploy-test` (**E2E lives here**) → `deploy-production` |
| `e2e.yml` | manual — `gh workflow run e2e.yml -f runs=N [-f filter=X]` | N E2E runs against the deployed test env, no deploy |

**A green PR does not predict a green deploy — E2E runs only in the deploy gate.** `pr.yml` also `paths-ignore`s `docs/**`, `**/*.md`, `.claude/**` and `scripts/**`, so a docs-only PR runs no checks at all except `docs-check.yml`.

Three consequences worth knowing before you trust a green:

- **A new E2E helper reaches `main` unexecuted.** Dispatch `e2e.yml --ref <branch>` first; 51-B's probe was reviewed six times and crashed on its first ever execution.
- **`e2e.yml` shares the deploy concurrency group** — it *cancels* a pending deploy rather than queueing. Run long counts when the merge queue is quiet.
- **A deploy with `backend=false` skips `cdk deploy` entirely.** "Merged + a green deploy exists" is not "live in prod" for an infra or route-contract slice — verify the resource itself.

## Proving a flake fix

A flake fix is not `Done` on merge — it needs **10 clean runs**, counted with `scripts/flake-watch.sh <since-deploy-#> [journey-regex]`.

Count **per attempt**, never by run conclusion: a deploy re-run into green still *contains* the failure. Reading conclusions is how BUG-38 was recorded as 6 recurrences when the real number was 26.
