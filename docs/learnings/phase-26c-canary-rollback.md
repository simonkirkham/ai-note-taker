# Phase 26-C — Backend canary deploy + automated rollback (shipped, then reverted)

**Slice:** 26-C · **PR:** #228 (shipped) → #231 (reverted) · **Status:** Reverted

## Outcome

Shipped, deployed once (canary worked — deploy #515 ran a clean ~5-min `CANARY_10PERCENT_5MINUTES` shift), then **reverted by decision** the same day. The mechanism was correct; the cost/benefit was wrong for this app.

## Why it was reverted

| Factor | Detail |
|---|---|
| Cost | The CodeDeploy-managed alias makes `cdk deploy` block on the bake, so **every** backend deploy gained ~5 min (SnapStart republishes a version on any code change). |
| Benefit | An alarm needs traffic to evaluate. On a single-user app most deploys have no concurrent traffic during the bake, so the canary almost always completes having proven nothing. |
| Trigger | The slowdown was immediately visible: deploy #515 sat in the canary bake while #516 (a sibling slice) queued behind it and errored with a stack-lock conflict. |

**Decision:** drop the canary. The ~5 min/deploy tax on a low-traffic personal app outweighed rollback protection that rarely had traffic to exercise. 26-A and 26-B (the user-facing zero-downtime wins, no deploy-time cost) stayed.

## Reusable learnings

1. **Canary/linear traffic shifting is a high-traffic tool.** Its value scales with concurrent traffic during the bake. On a single-user app it is mostly dead wait — measure expected in-bake traffic before adopting it.
2. **A CodeDeploy-managed Lambda alias serializes and slows the deploy pipeline.** `cdk deploy` blocks on the shift; with no workflow-level concurrency group, overlapping deploys then contend for the CloudFormation stack lock and the losers fail with "another update in progress" (what hit #516). If a canary is ever re-introduced, add a deploy concurrency group first.
3. **A `git revert` of a squash-merge is a single-parent revert** (`git revert <sha>`, no `-m`) and reverts cleanly here (96 deletions, infra suite back to 89). The construct-against-the-alias design also made the teardown clean — no function-hash/grant entanglement.
4. **The mechanism itself was sound** (SnapStart restore is per-version and completes before traffic shifts; auto-rollback wired to the existing alarms). Revisit only if traffic grows enough that an in-bake regression would actually be caught.
