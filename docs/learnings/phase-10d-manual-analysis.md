# Learnings: 10-D Manual Analysis via Bedrock

- Hawk 1 found five issues on the first pass: `BEDROCK_MODEL_ID` read per-call (should be constructor), `AmazonBedrockRuntimeException` uncaught (maps to 503), action items not deduplicated against existing data (projection can lag in production), `analyseError` not shown to the user, and `FakeBedrockAnalysisService.NextResult` not reset per test. All five are standard error-handling and test-isolation concerns applicable to any external-service endpoint. **Action:** Add a pre-Hawk self-review checklist to the implementation workflow: (1) config read in constructor with guard, (2) each AWS SDK exception type caught and mapped, (3) idempotency guard for every mutation, (4) user-visible error on failure — TODO.

- Converting `AnalyseNoteTests` from primary constructor to explicit constructor left `factory` references in two test methods unqualified; both failed to compile (`CS0103`). The fix is to immediately assign the constructor parameter to a `private readonly` field. **Action:** This is an easy mistake to make when changing constructor style — already fixed in this session; no further action — Done.

- `WithWebHostBuilder` creates a fully isolated `WebApplicationFactory` instance with fresh singleton instances. The first attempt at the Bedrock 503 test created the note via `_client` (original factory's in-memory store) and sent the analyse request via the throwing factory's client — got 404 because the two stores are separate. Fix: create all test data within the same factory instance that executes the assertion. **Action:** Document this isolation behaviour as a comment in the 503 test — Done (pattern applied in implementation).

- Context compaction occurred mid-Pip-session; the auto-generated summary was accurate and work resumed cleanly. The two-session structure added overhead but did not cause data loss or rework. **Action:** For large slices (10+ files), commit incrementally (backend green → frontend green → CDK green) so less state needs reconstructing if compaction occurs — TODO.

- **Bedrock Anthropic models require an FTU form and AWS Marketplace subscription.** First invocations may temporarily succeed while the background subscription is being established; subsequent calls fail with "Model use case details have not been submitted." The FTU form is separate from the model access page (which shows only "serverless models are automatically enabled"). **Action:** Default to Amazon's own models (`amazon.nova-lite-v1:0`) rather than Anthropic models on Bedrock — no FTU, no Marketplace subscription, on-demand inference in eu-west-2 without a cross-region inference profile — Done.

- **Amazon Nova Lite uses a different request/response schema from Anthropic.** Request body: `{ "schemaVersion": "messages-v1", "messages": [{"role": "user", "content": [{"text": "..."}]}], "inferenceConfig": {"maxTokens": N} }`. Response text is at `output.message.content[0].text`, not `content[0].text`. **Action:** Applied in `BedrockAnalysisService.cs` — Done.

- **Bedrock foundation-model IAM ARNs have no account ID.** CDK's `Arn.Format` injects `${AWS::AccountId}` by default, producing an ARN that Bedrock never matches. Fix: `Account = string.Empty` in `ArnComponents`. For cross-region inference profiles (`eu./us./ap.` prefix), two ARNs are needed: one inference-profile ARN (with account) and one wildcard-region foundation-model ARN (without account). Amazon Nova models avoid this entirely — direct on-demand, single ARN, no account — Done.

## Applied status

| Learning | Status |
|---|---|
| 1. Pre-Hawk self-review checklist | TODO — requires adding to workflow guidance in CLAUDE.md or agent-roles.md |
| 2. Primary-to-explicit constructor field assignment | Applied — fixed in session (no doc change needed; not a systemic pattern) |
| 3. WithWebHostBuilder isolation behaviour | Applied — correct pattern used in `PostAnalyse_WhenBedrockThrows_Returns503` test |
| 4. Incremental commits for large slices | TODO — architectural workflow guidance |
| 5. Anthropic FTU blocks production invocations | Applied — switched default to `amazon.nova-lite-v1:0` |
| 6. Nova Lite request/response schema | Applied — `BedrockAnalysisService.cs` updated |
| 7. Foundation-model ARN has no account ID | Applied — `Account = string.Empty` + inference-profile pattern documented |
