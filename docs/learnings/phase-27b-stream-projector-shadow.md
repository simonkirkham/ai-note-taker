# 27-B — DynamoDB Stream + Projector Lambda (shadow mode)

**Slice:** Phase 27-B · **PR** #248 (squash `d209777`) · **Deploy** #538 green · 2026-06-11.

Shipped the async Projector Lambda off a DynamoDB stream on the event store, running **shadow** to the still-inline write path. Banks the core event-sourcing lesson (Streams, idempotency, replay, DLQ, async-failure observability) with **zero** consistency change — the cutover is 27-C.

## Design decisions that aren't obvious from the code

### 1. The projector re-reads the full stream — it does NOT apply the stream record's NEW_IMAGE
A DynamoDB-stream record carries the row image, but the projector ignores the payload and instead keys off the **stream id** and re-reads the full stream via `IEventStore.ReadAsync`. Why:
- The re-fold projections (`title`/`detail`/`search`) need full history, which a single record can't give.
- It self-corrects a late / out-of-order / replayed record (the read is authoritative).
- It sidesteps mapping the Lambda `DynamoDBEvent.AttributeValue` shape back into an `EventEnvelope` for the apply path.

So `StreamRecordMapper` only extracts the **stream id** of event rows (filtering `META#stream` by `SK` not starting `v`), and `StreamProjector` does `read full → split at the processed-position mark → route by stream-id prefix`. The NEW_IMAGE view type is still required on the stream (the trigger), but the projector doesn't parse it.

### 2. The position guard is what makes redelivery safe — and it must advance only after a successful apply
`notetaker-proj-position` (PK=streamId, `LastSeq`) is the high-water mark. `newEnvelopes = full.Where(seq > lastSeq)`; if empty → skip (it's a redelivery). Advance `LastSeq` to the batch max **only after** `RouteAsync` succeeds, with a conditional `LastSeq < :seq` write so concurrent/replayed batches never regress it. This is the mechanism that makes the increment-based feedback counters (descoped from 27-A) redelivery-safe. The load-bearing test asserts a failed apply leaves `LastSeq` un-advanced (`-1`), so the record is retried, not silently skipped.

### 3. `ProjectionUpdater` had to become request-context-free first
It used `ICurrentUser.UserId`; the projector has no HTTP request. Sourcing `userId` from `envelope.Metadata.UserId` is byte-identical inline (the envelope was stamped with that same userId at write time) and is the version the projector needs. Done as a standalone behaviour-neutral commit (A1) proven by the unchanged 27-A suite — a clean precondition, not coupled to the projector.

### 4. Least-privilege IAM overflows into a managed policy
The projector's grants exceed CDK's inline-policy size limit, so CDK splits them across an `AWS::IAM::Policy` **and** an `AWS::IAM::ManagedPolicy`, and a single-action statement renders as a scalar (not an array). The infra assertions therefore walk the synthesized template across **both** policy types and tolerate scalar/array actions. The key boundary — `ProjectorRole_HasNoEventsTableWrite` — asserts the events table carries only stream-read + read-item statements, no `PutItem`/`TransactWriteItems`.

## Process lessons (cost drivers, not rework)

### Commit a cut-off sub-agent's partial work immediately, then continue
The Pass-A sub-agent was **terminated mid-run by a monthly spend limit** after 52 tool-uses with **no commit** — only A1's edits were on disk (uncommitted). Recovery that worked: verify the partial work builds + passes, **commit it to lock it in** (`ce93859`), then finish the rest by hand. Had I re-dispatched a fresh sub-agent without committing, a second cutoff could have lost A1. **Rule: when a delegated agent dies, the first move is to assess and commit whatever is sound before doing anything else.** (Added to the playbook.)

### Hawk caught a CI-gate miss the local build couldn't
Pass B added the projector publish to `deploy.yml` but not `pr.yml` — so the PR's own `cdk synth` check would have gone **red** (the `Code.FromAsset` dir wouldn't exist in the PR job), blocking the merge gate. Local build/synth was green because the agent had published locally. Hawk reproduced the failure empirically. **A new CDK asset needs its publish step in *every* workflow that synths — `pr.yml` and both `deploy.yml` jobs.**

### .NET Lambda package-downgrade chain
Adding `AWS.Lambda.Powertools.Metrics` + the Lambda serializer to a project that references the ASP.NET `Api` forced `Amazon.Lambda.Core` 2.5 → 2.8 → 3.0 → 3.1 across three NU1605 "downgrade-as-error" iterations (Powertools needs ≥2.8, Serialization 3.0 needs Core ≥3.0, Api transitively needs ≥3.1). When a new Lambda project references an existing one, pin `Amazon.Lambda.Core` to the version the existing project already resolves.

## Carried forward to 27-C
- Remove the inline `ProjectionUpdater` calls from the 5 handlers (projector becomes sole writer); move server-side read-after-write tests to bounded polling; update `architecture.md` + ADR 0001.
- The projector is already live and idempotent, so 27-C is "stop writing inline," not "start the projector."
- Optional post-deploy ops check (not done): confirm the projector's DLQ is empty and `ProjectorFailure`/iterator-age alarms are quiet now that it's processing the live stream from `TRIM_HORIZON`.
