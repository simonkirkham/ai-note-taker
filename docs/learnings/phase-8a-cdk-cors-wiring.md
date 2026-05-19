# Learnings: 8-A CDK + CORS wiring

- The spec included a "CDK template assertion for CORS Authorization header" scenario that was based on a wrong architectural assumption — CORS is handled by ASP.NET Core's `AllowAnyHeader()` middleware, not at API Gateway / CloudFormation level. Hawk caught this in the first review, requiring a fix commit and a second round. **Action:** Breaker should verify each spec scenario against the actual implementation architecture before writing tests; when a scenario can't be tested at the layer the spec describes, update the spec first. — Done (phase-8.md updated in the PR).

- The `?? ""` default for optional Lambda env vars is a deliberate pattern difference from the existing `DomainName`/`HostedZoneId` props (which are passed as raw nullables and used only when non-empty). Auth env vars need to always be present in the Lambda environment so consuming code can check `string.IsNullOrEmpty()` without a missing-key exception. A comment was added to explain the intent; without it Hawk correctly flagged the inconsistency. **Action:** When intentionally diverging from an established pattern, add a why-comment at the divergence point. — Done (comment added in NoteTakerStack.cs).

## Applied status

| Learning | Status |
|---|---|
| 1. Spec-architecture mismatch caught by Hawk | Applied — phase-8.md updated; CORS scenario replaced with note that AllowAnyHeader() covers it |
| 2. Undocumented `?? ""` divergence | Applied — comment added to NoteTakerStack.cs |
