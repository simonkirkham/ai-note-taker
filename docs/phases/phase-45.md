# Phase 45 — Data backup & durability hardening _(In Progress — 45-A done 2026-07-01)_

**Goal:** The owner's data survives an accidental delete or bad write, not just a stack teardown — every irreplaceable store has point-in-time recovery, versioning, or a scheduled backup behind it.

## Summary

| Slice | What the user gets | Status | Depends on |
|-------|--------------------|--------|------------|
| 45-A  | A mistaken deletion or corrupting write to their notes is recoverable — the note history can be restored to any point in the last 35 days | Done | — |
| 45-B  | An image they overwrote or deleted in a note can be recovered | Not Started | — |
| 45-C  | A stray table drop can't wipe their calendar/sign-in connections — the core token tables are protected from deletion | Not Started | — |
| 45-D  | Faster recovery after an incident — read views restore in seconds instead of a full history replay | Not Started | 45-A |
| 45-E  | A documented, tested way back after a disaster — scheduled off-table backups plus a written restore runbook with recovery targets | Not Started | 45-A, 45-C |

Slices are ordered by **permanence of loss**, not blast radius. 45-A (event store) is the keystone — its loss is catastrophic and unrecoverable. 45-B (images) is next: uploaded images are the *only copy* and are currently unversioned, so an overwrite/delete is permanent. 45-C (token tables) has the widest blast radius (a whole-table loss forces every user to re-consent) but the tokens are **re-mintable by re-auth** — recoverable friction, not data loss — so its high-value piece is deletion protection, not PITR. 45-D is lowest (those tables rebuild from the event store; PITR only buys restore speed).

## Slices

<!-- REVIEW SURFACE — the human reads this and stops. No technical artefact named below. -->

### Slice 45-A — Point-in-time recovery for the note history _(Done — 2026-07-01, PR #380, deploy #684)_

- **User value:** The complete record of every note, to-do, and edit is the one thing that can't be regenerated. Today only a full infrastructure teardown is guarded against; an accidental delete or a bad migration would be permanent. This makes the last 35 days recoverable to any second.
- **How it works:**
  - No visible change to the app — this is a durability guarantee behind the scenes.
  - The store holding all note history gains continuous point-in-time recovery: any moment in the trailing 35 days can be restored to a fresh copy.
  - Existing "never auto-delete on teardown" protection stays; this adds protection against deletes and corrupting writes *within* the live store.
- **Scenarios (GWT):**

```
Scenario: Note history is continuously recoverable
  Given the deployed infrastructure
  When  the note-history store is inspected
  Then  point-in-time recovery is enabled on it

Scenario: Teardown protection is unchanged
  Given the deployed infrastructure
  When  the note-history store is inspected
  Then  it still retains its data on stack deletion
```

### Slice 45-B — Versioning for uploaded note images

- **User value:** An image a user uploads into a note is the only copy. The bucket keeps just the latest object, so an accidental overwrite or a cleanup-bug delete is currently unrecoverable — permanent loss of the user's own content. Versioning keeps prior copies so any object can be rolled back.
- **How it works:**
  - The user-image store keeps previous versions of each object.
  - A lifecycle rule expires old non-current versions after a bounded window so storage stays cost-bounded.
  - No user-visible change; recovery is an operator action.
- **Scenarios (GWT):**

```
Scenario: Overwritten images are retained
  Given the deployed infrastructure
  When  the note-images store is inspected
  Then  object versioning is enabled

Scenario: Old versions are cost-bounded
  Given the deployed infrastructure
  When  the note-images store is inspected
  Then  a lifecycle rule expires non-current versions after a bounded window
```

### Slice 45-C — Lock the sign-in token tables against deletion

- **User value:** The stored Google/Outlook/MCP tokens keep every calendar and connector working. Losing them forces every user to reconnect and re-authorise — a wide-reaching disruption, though the tokens themselves are re-mintable. The real irrecoverable risk is a stray table drop, so these tables get deletion protection; recovery cover (PITR) is added too since it's cheap.
- **How it works:**
  - The token stores (and the note-history store) gain deletion protection, so they can't be dropped by a stray console/CLI action even by an operator.
  - The token stores also gain point-in-time recovery, matching the note history.
  - No user-visible change.
- **Scenarios (GWT):**

```
Scenario: Core tables cannot be accidentally dropped
  Given the deployed infrastructure
  When  the note-history store and each token store are inspected
  Then  deletion protection is enabled on them

Scenario: Token stores are recoverable
  Given the deployed infrastructure
  When  each auth/calendar/MCP token store is inspected
  Then  point-in-time recovery is enabled on it
```

### Slice 45-D — Fast restore for the read views

- **User value:** The read views rebuild from note history, so they are never *lost* — but a full replay after an incident is slow. Point-in-time recovery on them turns a minutes-long rebuild into a seconds-long table restore.
- **How it works:**
  - Each projection store gains point-in-time recovery.
  - Purely a recovery-speed optimisation; correctness already comes from the rebuild path.
  - No user-visible change.
- **Scenarios (GWT):**

```
Scenario: Read views are point-in-time restorable
  Given the deployed infrastructure
  When  each projection store is inspected
  Then  point-in-time recovery is enabled on it
```

### Slice 45-E — Scheduled off-table backups and a restore runbook

- **User value:** Point-in-time recovery only reaches back 35 days and only within the account. This adds longer-retention, off-table (and optionally cross-region) recovery points, plus a written runbook so recovery is a known procedure, not an improvisation.
- **How it works:**
  - A scheduled backup captures the durable stores on a cadence into a separate vault with longer retention.
  - A short runbook documents recovery targets (how much data loss / how long to restore is acceptable) and the exact restore steps.
  - No user-visible change.
- **Scenarios (GWT):**

```
Scenario: Durable stores have scheduled backups
  Given the deployed infrastructure
  When  the backup plan is inspected
  Then  it captures the note-history and token stores on a schedule into a dedicated vault

Scenario: Recovery is documented
  Given the docs
  When  the disaster-recovery runbook is read
  Then  it states the recovery-point and recovery-time targets and the restore procedure
```

---

## Build notes _(implementation — skip when reviewing)_

Context: this is pure infrastructure — no aggregates, events, projections, or API routes. The "spec" for each slice is a set of `Infrastructure.Assertions` CDK-template assertions. Every slice touches the deploy path via `cdk deploy`; state the deploy-time delta in the PR. Enabling PITR / versioning / a backup plan is a **one-off stack-update cost**, negligible recurring spend on PAY_PER_REQUEST tables — no bake/canary, deploy-time impact **neutral**. `cdk synth` requires publishing **all three** Lambda projects first (`Api`, `Projector`, `TranscribeCompletion`) — each `FromAsset`s a `bin/Release/net10.0/publish` dir or synth aborts with `Cannot find asset` (see the 45-A minor-log entry).

### 45-A _(Done — 2026-07-01, PR #380, deploy #684)_
- **Change:** `src/Infrastructure/NoteTakerStack.cs` — add `PointInTimeRecoverySpecification { PointInTimeRecoveryEnabled = true }` to `EventsTable` (`notetaker-events`). `RemovalPolicy.RETAIN` and the `NEW_IMAGE` stream unchanged.
- **Tests:** `InfraAssertionsTests.EventsTable_HasPointInTimeRecovery` (asserts PITR true; the pre-existing `EventsTable_HasRetainDeletionPolicy` already covers `DeletionPolicy: Retain`).
- **Acceptance criteria:**
  - [x] `notetaker-events` synthesises with `PointInTimeRecoverySpecification.PointInTimeRecoveryEnabled = true`.
  - [x] `notetaker-events` retains `DeletionPolicy: Retain`.
  - [x] Full `Infrastructure.Assertions` suite green (161 tests); `cdk synth` succeeds.
- **Deploy-time:** neutral (one-off table update; PITR enabled in-place, no replacement).
- **Scribe (infra live-check):** ✅ verified live in prod 2026-07-01 — `describe-continuous-backups` → `PointInTimeRecoveryStatus: ENABLED`, `RecoveryPeriodInDays: 35`.

### 45-B
- **Change:** `NoteImagesBucket` — `Versioned = true`; add a `LifecycleRule` with `NoncurrentVersionExpiration = Duration.Days(<N>)` (choose a bounded window, e.g. 30–90 days) alongside the existing incomplete-multipart-abort rule. `RemovalPolicy.RETAIN` / `AutoDeleteObjects = false` unchanged.
- **Tests:** assert the bucket has `VersioningConfiguration.Status = Enabled` and a non-current-version expiration lifecycle rule.
- **Acceptance criteria:**
  - [ ] `NoteImagesBucket` synthesises with versioning enabled.
  - [ ] Non-current versions expire after the bounded window.
- **Deploy-time:** neutral. (`RecordingsBucket` deliberately excluded — ephemeral working artefact, DESTROY + 7-day expiry.)
- **Scribe (infra live-check):** after deploy, verify in prod: `aws s3api get-bucket-versioning --bucket <NoteImagesBucket name> --profile prod --region eu-west-2` shows `Status: Enabled`.

### 45-C
- **Change:** add `DeletionProtection = true` to `notetaker-events` + `notetaker-auth-tokens`, `notetaker-calendar-tokens`, `notetaker-mcp-refresh-token`; add PITR to the three token tables.
- **Note:** DeletionProtection on a table is a separate control from CloudFormation `DeletionPolicy: Retain` — Retain guards a stack delete; DeletionProtection guards a direct `DeleteTable` API call. This is the irreplaceable-loss guard; PITR here is the cheap add-on (tokens are re-mintable by re-auth, so PITR alone buys little).
- **Tests:** per-table `..._HasDeletionProtection` / `..._HasPointInTimeRecovery` assertions mirroring 45-A.
- **Acceptance criteria:**
  - [ ] Event store + three token tables synthesise with `DeletionProtectionEnabled = true`.
  - [ ] All three token tables synthesise with PITR enabled.
- **Deploy-time:** neutral.

### 45-D
- **Change:** add PITR to every `notetaker-proj-*` projection table (`notetitlelist`, `notedetail`, `noteactions`, `todolist`, `notecardlist`, `foldertree`, `tagindex`, `tagfeedback`, `actionfeedback`, `notesearchview`, `workspacelist`). `calendarlinkindex` already has it.
- **Rationale:** these rebuild from the event store via `ProjectionRebuildHandler`, so PITR is a recovery-*speed* optimisation, not a correctness requirement — hence lowest priority.
- **Tests:** parameterised assertion that every `notetaker-proj-*` table has PITR enabled.
- **Deploy-time:** neutral.

### 45-E
- **Change:** an `AWS::Backup` plan + dedicated vault selecting the durable tables (event store + token tables; optionally the images bucket) on a schedule with longer retention than the 35-day PITR window; optional cross-region copy action. New CDK constructs (`Amazon.CDK.AWS.Backup`).
- **Docs:** new `docs/disaster-recovery.md` runbook — state RPO/RTO targets and the step-by-step restore procedure for (a) PITR restore-to-new-table + cutover, (b) S3 version rollback, (c) AWS Backup recovery-point restore.
- **Tests:** assert the backup plan + vault exist and select the durable tables; assert a schedule rule.
- **Deploy-time:** the backup **jobs** run out-of-band (not in the deploy); the plan is a one-off stack addition — neutral deploy-time.
- **Decision to confirm at slice start:** whether an off-table/cross-region plan is warranted for a single-user app, or whether 45-A–45-D (PITR + versioning) already meet the durability bar. Match resilience cost to scale (see the deploy-time-is-a-first-class-cost guardrail).
