# Learnings: Phase 0-A — BDD Harness and Solution Scaffold

## What was inefficient or went wrong

- **SDK version mismatch.** Breaker scaffolded the Specs project with `net10.0` (the `dotnet new` default on the machine) despite the feature brief specifying `net8.0`. The mismatch was only caught at hand-off review, requiring a separate fix commit before Pip could proceed. One extra round-trip.

- **Slice label not documented.** Scout introduced the "0-A / 0-B" sub-slice naming in the feature brief, but the roadmap still had Phase 0 as a single undivided block. The branch was named `phase-0a-harness` against a label that didn't exist in any doc. The roadmap had to be updated retroactively after the branch was already pushed.

- **Stale comments committed by Pip.** The stub comments written by Breaker ("Pip will replace these", "Both will FAIL with NotImplementedException") were never removed when Pip implemented the real harness. Hawk caught them, requiring a cleanup commit after the review rather than a clean first pass.

## Suggested process improvements

- **Breaker should verify the target framework before scaffolding.** Breaker's rules should include: check the agreed target framework in the feature brief before running `dotnet new`, and confirm it matches an installed SDK.

- **Scout should update the roadmap with sub-slice names before Breaker begins.** Any slice label used in a feature brief must exist in `docs/roadmap.md` before the branch is created. The roadmap is the canonical reference; branch names derive from it, not the other way around.

- **Pip's definition of done should include removing scaffolding comments.** Pip's rules should include a pre-PR step: search for and remove any comments that describe the code as stubs, placeholders, or pending implementation, since these become false once the real code lands.

- **`gh` CLI not available in this environment.** Pip's workflow calls for merging via `gh pr merge`, but the `gh` CLI is not installed. Pip had to hand the merge back to the human, breaking the automated hand-off.

- **Verify `gh` is installed as part of environment setup.** Add `gh` CLI installation to the Phase 0 setup checklist. Pip should check for it early and flag if missing rather than failing at the merge step.

## Hawk review findings

| Finding | File | How to prevent |
|---|---|---|
| Stale file-level comment described code as stubs throwing `NotImplementedException` | `tests/Specs/Harness/BddHarness.cs:3–7` | Pip: remove scaffolding comments before opening a PR |
| Stale comment said both specs would fail; they pass | `tests/Specs/Harness/SpecHarnessSpecs.cs:41–43` | Pip: remove scaffolding comments before opening a PR |
| Redundant `using Specs.Harness` inside `namespace Specs.Harness` | `tests/Specs/Harness/SpecHarnessSpecs.cs:1` | Breaker: run `dotnet build` with warnings-as-errors or review usings before committing |
