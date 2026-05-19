# Learnings: 9-G CDK wiring (CalendarLinkIndex table + SSM grant)

- CDK `TableProps.PointInTimeRecovery` (bool) is deprecated — the compiler emits CS0618 and a CDK `[WARNING]` during `cdk synth`. **Action:** Updated cdk-stack-update SKILL.md to use `PointInTimeRecoverySpecification = new PointInTimeRecoverySpecification { PointInTimeRecoveryEnabled = true }` — Done.

- When asserting a conditional IAM grant in an `Infrastructure.Assertions` test, Hawk required two additions: (1) verify the `Resource` field contains the specific ARN (SSM ARN is a `Fn::Join` intrinsic — match it with `Match.ObjectLike(["Fn::Join"] = Match.ArrayWith([Match.ArrayWith([Match.StringLikeRegexp(".*parameter/path$")])]))`) and (2) a negative test that confirms the grant is absent from the base template (use `Record.Exception` to assert `HasResourceProperties` throws when no SSM path is configured). **Action:** Added both patterns to cdk-stack-update SKILL.md — Done.

- `GOOGLE_REFRESH_TOKEN_SSM_PATH` is a new deployment secret that docs/README.md didn't mention. **Action:** Added to the deployment secrets table in README.md — Done.

## Applied status

| Learning | Status |
|---|---|
| 1. Deprecated `PointInTimeRecovery` | Applied — cdk-stack-update SKILL.md updated with replacement syntax |
| 2. Conditional IAM assertion patterns (Fn::Join resource + negative test) | Applied — cdk-stack-update SKILL.md updated with both patterns |
| 3. New `GOOGLE_REFRESH_TOKEN_SSM_PATH` secret undocumented | Applied — README.md deployment secrets table updated |
