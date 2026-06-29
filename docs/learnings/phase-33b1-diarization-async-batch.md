# 33-B1 — Diarized transcript via async Transcribe batch

Slice shipped #328 / deploy #631 (2026-06-24). Diarize trigger (Command Lambda) → Transcribe batch job → EventBridge "Transcribe Job State Change" → new `TranscribeCompletion` Lambda → `TranscriptionDiarized` event → frontend reload-tolerant poll on `transcriptIsDiarized`.

## Non-obvious learnings

### 1. A new `AddToRolePolicy` on a near-limit role silently splits the DefaultPolicy into an overflow ManagedPolicy — which reshuffles unrelated grants and breaks their template assertions.

- The Command role's auto-generated `DefaultPolicy` was already at the **6144-byte** managed-policy size limit. Adding one `transcribe:StartTranscriptionJob` statement via `commandFunction.AddToRolePolicy(...)` pushed it over, so CDK moved overflow statements into a **separate `AWS::IAM::ManagedPolicy`** (`...ServiceRoleOverflowPolicy`). The `ssm:GetParameter` statement landed in the overflow → the two SSM-grant assertions (which look only in `AWS::IAM::Policy`) failed with "found 9 not 8 / none match".
- **Which statements overflow is order/size-dependent and unpredictable** — a future grant could shuffle a *different* statement and break a *different* assertion.
- **Fix:** add the grant as a **dedicated `new Policy(this, …, { Roles = [fn.Role!], Statements = [...] })`** resource instead of growing the DefaultPolicy. DefaultPolicy stays byte-identical → every existing grant assertion stays green, no overflow.
- This is distinct from, and compounds with, the existing CurrentVersion-hash guardrail (that one is about *aliased* functions; the Command function is `$LATEST`, so the hash issue didn't apply — only the size-overflow did).

### 2. `StartTranscriptionJob` with no `DataAccessRole` runs as the *caller's* identity.

- Transcribe reads the input WAV and writes the result JSON using the **calling Lambda's** IAM permissions. So the output must land somewhere the caller can write: output key is under `recordings/` to reuse the existing `recordings/*` grant. No separate data-access role needed.
- The completion Lambda reads the result via `GetTranscriptionJob().Transcript.TranscriptFileUri`, **not** the output key — so the `OutputKey` value is advisory; the read path is robust to AWS path conventions.

### 3. The async completion handler is the opposite event-store stance to the Projector.

- The Projector is **read-only** on the event store (folds into read models). The `TranscribeCompletion` Lambda must **append** (`TranscriptionDiarized`), so it needs `GrantReadWriteData` + `dynamodb:TransactWriteItems` (the optimistic-concurrency append path) — load→handle→append on the pure aggregate, owner/workspace from `history[0].Metadata` (no HTTP scope). Same non-HTTP host shape, inverted permission.

### 4. Keep the failure alarm high-signal: a benign empty/no-result is not a fault.

- A recording of silence diarizes to empty text — a benign success, not a fault. Metering it as `BatchFailed` would page on it. Reserve `TranscribeBatchFailed` for genuine faults (FAILED job, fetch error, poison JSON); empty-text and no-result are log-only. (Hawk Minor.)

### 5. E2E scope: no deploy-gate round-trip journey.

- A real batch job is **minutes** long and there is no headless recording E2E harness — a blocking gate journey would add a recurring per-deploy cost (the *deploy-time-is-first-class* guardrail). The async loop is unit+integration-covered; the one-real-call acceptance is a manual post-deploy check. Rationale table in `docs/phases/phase-33.md`. Re-evaluate if a recording harness ever exists.

### 6. Two parallel sessions independently fixed the same CI flake.

- Frontend CI flaked (`TokenRefresh` fetch-spy race + `Auth` worker-teardown race). Root cause: calendar MSW handlers (added by 34-A) were registered **rootless-only** while the App calls them **workspace-scoped** → unhandled → retry/console flood racing under CI timing. Both this slice and main's **34-B** fixed it the same way (register via `scoped()`); the merge collapsed them. Lesson: when a handler is added for an endpoint the full-App boot calls, register **both** forms via `scoped()`, or every App-mounting test floods console and flakes.

## Follow-ups
- **One-real-call acceptance (manual):** record a short call in prod → confirm the transcript becomes speaker-labelled and `TranscribeBatchCompleted` fires on the dashboard. (Not automatable without a recording E2E harness.)
- **33-B2** scales this: extract `AnalyseNote` into a non-HTTP `INoteAnalysisService` the completion Lambda calls after appending the diarized event (single analysis on the winning transcript).
