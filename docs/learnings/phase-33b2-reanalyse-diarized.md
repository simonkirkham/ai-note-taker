# 33-B2 — Re-analysis on the diarized transcript

Shipped #336 / deploy #637 (2026-06-24). A recorded note is now analysed **exactly once**, on the winning transcript: the diarized one when the Transcribe batch job succeeds, the streamed one when it fails. Completes Phase 33.

## Non-obvious learnings

### 1. A new field on an existing projection needs the DynamoDB store mapping AND a DynamoDB-Local test — the in-memory test double hides the gap.

- Adding `NoteDetailView.OwnerName` + folding it in `NoteDetailProjection` made every `Api.Integration` test pass — because `InMemoryNoteDetailStore.UpsertAsync` stores the **whole view object by reference**, so any new field round-trips for free.
- But `DynamoDbNoteDetailStore` maps **each attribute explicitly** (`UpsertAsync` writes named attributes; `MapItemToNoteDetailView` reads named attributes). A new field not added there **evaporates at the DynamoDB boundary** → `""` in prod. Tests stayed green; prod silently broke. (Hawk Blocker.)
- **Only a DynamoDB-Local (`EventStore.Integration`) round-trip test catches this** — set the field → `UpsertAsync` → `GetAsync` → assert it survived. The in-memory double structurally cannot.
- **Rule:** when you add a field to a `*View`, update **both** stores and add a DynamoDB-Local round-trip assertion in the same slice. Sibling of "a new projection ships empty" — same masking, finer grain. Now a CLAUDE.md guardrail.

### 2. Running command handlers outside HTTP scope — identity-explicit overloads, not ambient state.

- The async re-analysis (TranscribeCompletion Lambda) has no scoped `ICurrentUser`/`ICurrentWorkspace`. Rather than a mutable/ambient current-user, the command handlers gained `HandleAsync(cmd, userId[, workspaceId], ct)` overloads; the HTTP overloads **delegate** to them with the scoped identity, so HTTP behaviour (and every existing test) is byte-identical. The Lambda registers **throwing** `ICurrentUser`/`ICurrentWorkspace` stubs — only the explicit overloads are used, so anything resolving them fails loud.
- This is the reusable pattern for "the same write flow runs from HTTP and from an async Lambda."

### 3. The async handler must read decisions/intent strongly, not from the lagging projection.

- **Transcript freshness:** the Lambda just appended `TranscriptionDiarized`; the projection still lags, so it passes the **parsed diarized text directly** as `transcriptOverride` instead of letting the service re-read the stale stored transcript. Content/tags/existing-actions are read from the projection (warm — written in the original session) as analysis *input*, not a decision.
- **Owner identity** is read from `history[0].Metadata` (event stream), never a projection — same RYW/authz discipline as 33-B1.

### 4. Intent the async handler needs must be plumbed to it explicitly — auto-analyse-OFF correctness.

- The completion Lambda must analyse **only when the user had auto-analyse ON**, else an OFF note gets unwanted analysis (+ Bedrock cost). The toggle is frontend-only, so it rides the **job name** (`-a`/`-n` suffix via `DiarizationJobNames`, `ShouldAnalyse` = `EndsWith`). The async event carries no custom payload, so the job name is the only channel.

### 5. The on-Stop defer must beat the async trigger — synchronous state + started-vs-failed distinction.

- The on-Stop auto-analyse effect fires the instant `status==='stopped'`, seconds before the diarize `202`. So diarization is set `'refining'` **synchronously** in `uploadRecording` (before the async upload; `stopRecording` calls it before `setStatus('stopped')`, so the effect sees both batched). States: `'refining'`/`'timedOut'` (job started → server owns the one analyse, keep deferring) vs `'failed'` (never started → local fallback analyse). Without the started-vs-failed split, a failed trigger would leave the note un-analysed.

### 6. A worktree can be based on a parallel session's unpushed WIP.

- `git worktree add -b` branches from the **local** main tip, which a parallel session had advanced with an unpushed Phase 35 doc commit. My PR carried it (Hawk flagged it). **Rebase `--onto origin/main`** to drop it and re-base on the real remote main. Check `git merge-base --is-ancestor <base> origin/main` if a worktree's base looks unfamiliar.

## Verified live in prod
Completion Lambda env (`BEDROCK_MODEL_ID`, `PROJ_NOTEDETAIL/NOTEACTIONS`), `bedrock:InvokeModel` (dedicated `TranscribeCompletionBedrockPolicy`), `GetTranscriptionJob`. The two notes back-filled earlier this session can be re-diarized to exercise the new re-analyse path end-to-end.

## Follow-up (out of scope)
- Old notes (created pre-33-B2) have no `EventMetadata.UserName` → `OwnerName` is `""` → the re-analysis prompt sees an empty name (degraded action-item attribution only). A backfill could fold names from a name source if it ever matters; not worth it now.
