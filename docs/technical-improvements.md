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

## Fix stale test project paths in `.githooks/pre-commit`

**What:** The committed `.githooks/pre-commit` invokes `dotnet test` against project paths that no longer exist after the tests were renamed to dotted form. Update the three stale references:
- `tests/Specs/Specs.csproj` → `tests/Domain.Specs/Domain.Specs.csproj`
- `tests/ApiIntegration/ApiIntegration.csproj` → `tests/Api.Integration/Api.Integration.csproj`
- `tests/InfraAssertions/InfraAssertions.csproj` → `tests/Infrastructure.Assertions/Infrastructure.Assertions.csproj`

While there, consider adding `cdk synth` to the hook to match the guardrail "Never commit without all BDD specs green and cdk synth succeeding", and deleting the leftover empty `tests/Specs`, `tests/ApiIntegration`, `tests/InfraAssertions`, `tests/EventStoreIntegration` directories (stale `bin`/`obj` output from before the rename).

**Why it matters:** The documented "activate once per clone" step (`git config core.hooksPath .githooks`) makes the hook fail immediately at the `domain specs` step, blocking every commit. Because the default `core.hooksPath` (`.git/hooks`) has no pre-commit, the hook has been dormant and commits have been effectively ungated — so the documented local gate provides no protection today.
**Raised in:** Phase Minor Changes — discovered when activating the hook for CHANGE-1.
**Depends on:** Nothing blocking.
