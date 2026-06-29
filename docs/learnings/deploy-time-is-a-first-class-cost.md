# Deploy time is a first-class cost — flag it before merge

**Source:** Phase 26-C (canary deploy shipped then reverted same-day).

## The principle

**Deploys are a bottleneck. A change that adds per-deploy time taxes every future change, compounding across the whole team and pipeline.** Treat deploy-time (and pipeline-throughput) cost as a first-class review dimension — surface it *before* merge, not after a maintainer asks "why did deploys get slower?".

## What happened

26-C wrapped the Lambda alias in a CodeDeploy canary (`CANARY_10PERCENT_5MINUTES`). It worked correctly, but it made `cdk deploy` **block ~5 min on every backend deploy** (SnapStart republishes on any code change). The slowdown was immediate and visible: the canary deploy held the CloudFormation stack lock, so a sibling slice's deploy queued behind it and errored with "another update in progress". Reverted the same day — the per-deploy tax outweighed rollback protection that, on a single-user app, rarely had traffic to exercise.

## Rules of thumb

1. **Any change that touches the deploy path must state its deploy-time delta** (faster / neutral / +N min) in the PR and the phase doc. A recurring cost gets an explicit accept/reject, not a silent introduction.
2. **Per-deploy cost compounds.** "+5 min once" is fine; "+5 min on every deploy forever" is a different decision. Distinguish one-off from recurring.
3. **Serializing the pipeline is itself a cost.** Anything that holds a shared lock (the CloudFormation stack) longer makes concurrent deploys contend and fail — not just slow.
4. **Match resilience cost to scale.** Traffic-shifting / bake-window mechanisms pay off with real concurrent traffic; on a low-traffic app they are mostly dead wait. Measure expected benefit before paying a standing cost.
5. **Prefer changes that keep deploys fast.** When a slower deploy is genuinely warranted, gate it (e.g. only on risky changes) rather than taxing every deploy.

## Where this is enforced

Added to `CLAUDE.md` Guardrails so it is read every session, and applied during Hawk review (deploy-time impact is a named check for deploy-path changes).
