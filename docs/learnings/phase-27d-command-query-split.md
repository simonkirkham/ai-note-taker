# Phase 27-D — Split the request Lambda into Command + Query functions

**Shipped:** PR #278 (merged `229fd04`), live in prod via deploy **#574**. Prod now runs `CommandFunction` + `QueryFunction` + `ProjectorFunction`; the single `ApiFunction` is retired. Completes ADR 0009 Stage 1.

## What shipped

| Aspect | Decision |
|---|---|
| Binary | One shared `Api` asset → two functions. Split enforced by **API Gateway method routing + per-function IAM**, not by code. No `Program.cs` change. |
| Query (reads) | SnapStart + `live` alias. IAM: projection tables **read-only** + proj-position read + draft `GetItem` + events `DescribeTable` (health). Zero event-store data access, zero write verbs, no side services. |
| Command (writes) | `$LATEST`, no SnapStart. IAM: event store R/W + Transact + side services (Bedrock/STS/SSM/images) + draft R/W/D + projection R/W **for the admin rebuild path only** (documented exception). Serves writes + the two side-service GETs (`/calendar/{date}`, `/transcription/credentials`). |
| Deploy time | SnapStart on Query only → **one** SnapStart publish/deploy → neutral. Writes are masked by optimistic UI, so the Command path needs no snapshot. |

## Lessons (the non-obvious bits)

### 1. The merge gate can read a stale green: a re-run flips a `completed` deploy back to `in_progress`
The "main's latest deploy is `completed`+`success`, none in progress" gate was checked with `gh run list --limit 1`. A run that had gone `completed success` was **re-run** (by the parallel session / retry), which resets the *same* run to `in_progress`. A single snapshot caught the transient green and the merge proceeded while a deploy was actually in flight — the exact thing the guardrail forbids. The tell was already visible: the run had oscillated `completed → in_progress → completed` in earlier polls.
**Apply:** don't trust one `--limit 1` green. Require quiescence — **no `in_progress`/`queued` across the last few deploy runs** — before merging. If you've seen a run oscillate, wait for it to settle definitively. (Codified in CLAUDE.md merge-gate guardrail.)

### 2. "Merged ≠ in prod" for an infra slice whose own deploy flaked
27-D's deploy (#569) ran `cdk deploy` in **deploy-test** (the split reached the *test* env) but the flaky E2E gate failed → **`deploy-production` skipped**. The next *green* deploys (#572…) were triggered by **test/web-only** commits, so `detect-changes` set `backend=false` → `cdk deploy` was **skipped** → those green deploys were **no-ops for infra**, and prod kept running the old `ApiFunction`. 27-D only reached prod when a later **backend** push (BUG-29, `fix(infra):`) triggered a full `cdk deploy --all` that shipped the whole HEAD stack (incl. 27-D).
**Apply:** for an infra slice, "merged + a green deploy exists" is **not** proof it's live. Verify (a) the deploy that ran had `detect-changes backend=true`, and (b) the resource is actually present in prod (`aws lambda list-functions --profile prod`). The deploy workflow is **push-only — no `workflow_dispatch`**, and a re-run replays the run's *original* sha (stale if main moved), so you cannot manually deploy current HEAD; a backend-touching push is what ships infra.

### 3. The flaky deploy-gate E2E is a shared, recurring tax
Three consecutive deploys failed on a *different* Tags/NoteImage journey each run (30s element-wait timeouts) — classic flake, tracked as TI-39 / BUG-26/28. It blocked an unrelated, correct, approved slice from merging and shipping for an extended window. Until TI-39 lands, expect infra slices to need a follow-on backend deploy (or a quarantine like BUG-28) to actually ship.

### 4. Test-vs-CI parity: `TreatWarningsAsErrors`
Local `dotnet test` passed but CI's `dotnet build -p:TreatWarningsAsErrors=true` rejected `Assert.Equal(1, x.Count)` (xUnit2013 → `Assert.Single`). **Apply:** for analyzer-sensitive test edits, build with `-p:TreatWarningsAsErrors=true` locally before pushing, not just `dotnet test`.

## What went well
- The IAM least-privilege boundary was verified by Hawk against the *synthesized* template + a full endpoint→store trace, not just asserted — caught that `GET /notes/{id}` reads the draft store (Query needs `GetItem`) and that `/health` describes the events table (Query needs metadata-only `DescribeTable`).
- Two side-service GETs were correctly pinned to Command via more-specific routes, keeping Query genuinely projection-only.
