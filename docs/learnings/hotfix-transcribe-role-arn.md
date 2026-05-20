# Learnings: TRANSCRIBE_ROLE_ARN production hotfix

- CDK v2 `currentVersion` hashes the Lambda **code asset only** — not environment variables. A placeholder `""` was published in the 10-B version; every subsequent env-var-only fix commit left the version hash unchanged, so CloudFormation never published a new version and the Production alias kept routing to the stale one with `TRANSCRIBE_ROLE_ARN=""`. **Action:** Added `Description = "AI Note Taker API"` to the Lambda `FunctionProps` to shift the version hash and force a fresh version to be published with the correct env var — Done.

- When an env-var fix deploy has no effect, check whether the CDK version resource logical ID actually changed (compare `ApiFunctionCurrentVersion<hash>` in `cdk synth` output before and after). If the hash is the same, no new version was published and the alias remains on the stale version regardless of how many deploys run. **Action:** Documented in memory (`feedback_cdk_add_environment.md`) — Done.

- The production-only symptom (Test worked, Production failed) prolonged diagnosis by three deploy cycles. Test and Production share the same CDK code, but Production happened to have its first 10-B version published with `""` because of the placeholder. Test's version was published correctly (the env-var placeholder wasn't the root cause, the stale-version mechanism was). **Action:** When a bug is production-only and the CDK template looks correct, check whether a stale Lambda alias version is involved — add this to the CDK debugging mental model — Done (documented here).

- Ordering `AddEnvironment` before the `Alias` (which accesses `CurrentVersion`) is the correct convention even though CDK v2 evaluates the hash lazily at synthesis time. **Action:** Reordered `TranscribeBrowserRole` block to precede the `LiveAlias` construction in `NoteTakerStack.cs` as defensive practice — Done.

## Applied status

| Learning | Status |
|---|---|
| 1. Add `Description` to force Lambda version hash change | Applied — `NoteTakerStack.cs`: `Description = "AI Note Taker API"` |
| 2. Diagnose stale alias via version hash comparison | Applied — documented in `memory/feedback_cdk_add_environment.md` |
| 3. Production-only env-var bugs → check stale alias version first | Applied — documented here as CDK debugging pattern |
| 4. `AddEnvironment` before `CurrentVersion` access | Applied — `NoteTakerStack.cs` reordered: TranscribeBrowserRole before LiveAlias |
