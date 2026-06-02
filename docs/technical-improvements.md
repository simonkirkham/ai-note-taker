# Technical Improvements

Technical, infrastructure, and developer-experience items to address in the future. These are **not user-facing features** — they're refactors, upgrades, CI/CD work, and hardening that keep the system healthy. Review this list when planning a phase or when an item becomes urgent.

For the other tracks see:
- **Features** → [docs/future-features.md](future-features.md)
- **Bugs** → [docs/phases/phase-bugs.md](phases/phase-bugs.md)
- **Minor tweaks & changes** → [docs/phases/phase-minor-changes.md](phases/phase-minor-changes.md)

Each entry records what it is, why it matters, where it was raised, and any dependency. When an item is actioned, mark it Done or remove it.

---

## Upgrade GitHub Actions to Node.js 24

**What:** Update `actions/checkout`, `actions/setup-node`, `actions/cache`, `actions/upload-artifact`, and `aws-actions/configure-aws-credentials` to versions that run on Node.js 24. Alternatively set `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24=true` in workflows as a quick opt-in to verify nothing breaks, then pin updated action versions.
**Why it matters:** Node.js 20 actions are deprecated; GitHub forces Node.js 24 by default from 2026-06-02 and removes Node 20 from runners on 2026-09-16. Will break CI if ignored.
**Raised in:** Phase 6 / adhoc CI observation.
**Depends on:** Nothing blocking. Confirm updated major versions exist for each action before upgrading.

---

## Investigate whether CDK synth needs real AWS credentials in `validate.yml`

**What:** If the CDK app does no context lookups (SSM, VPC resolution, etc.), `cdk synth` can run without credentials. If confirmed, remove the `Configure AWS credentials` step and `environment: Test` from `validate.yml` — validate becomes a pure code-quality gate with no AWS dependency.
**Why it matters:** Removes an unnecessary AWS dependency from the PR-validation path, simplifying CI and reducing the blast radius of credential issues.
**Raised in:** CI / Dev Experience observation.
**Depends on:** Confirm the CDK app performs no environment-bound context lookups during synth.

---

## Add `cdk synth` to the pre-commit hook

**What:** The pre-commit hook builds, lints, typechecks, and runs the test suites, but does **not** run `cdk synth`. Add it so the local gate matches the guardrail "Never commit without all BDD specs green and `cdk synth` succeeding." Note `cdk synth` requires a prior `dotnet publish` of the API, so factor that into the step.
**Why it matters:** The hook otherwise lets through commits that break CDK synthesis, which then fail later in CI/deploy.
**Raised in:** Spun off from the now-resolved stale-test-paths fix (840464b) — that change corrected the hook's project paths and removed the leftover empty test dirs, but left the `cdk synth` suggestion unactioned.
**Depends on:** Nothing blocking. Decide whether the `dotnet publish` cost is acceptable in a pre-commit gate.

---

## Pre-commit hook runs frontend eslint even for backend-only commits

**What:** `.githooks/pre-commit` runs `eslint` unconditionally. Backend/infra-only slice worktrees skip `npm --prefix web install` (to avoid Node-version lockfile drift), so the hook fails with `eslint: not found` even when no `web/` files changed — forcing `git commit --no-verify`. Make the frontend lint conditional: skip it when no staged paths are under `web/`, or when `web/node_modules` is absent (and print a notice).
**Why it matters:** Recurs on every backend/infra slice (hit on 12-C; will recur on 12-D/12-E). Routinely bypassing the hook with `--no-verify` erodes the local gate's value and hides real frontend lint failures when they do matter.
**Raised in:** Phase 12 (12-C) — backend/infra slice worktree.
**Depends on:** Nothing blocking. Touches the same file as the `cdk synth` item above.
