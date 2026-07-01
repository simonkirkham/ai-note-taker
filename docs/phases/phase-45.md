# Phase 45 — Data backup & durability hardening _(In Progress — 45-A done 2026-07-01)_

**Goal:** The owner's data survives an accidental delete or bad write, not just a stack teardown — every irreplaceable store has point-in-time recovery, versioning, or a scheduled backup behind it.

## Summary

| Slice | What the user gets | Status | Depends on |
|-------|--------------------|--------|------------|
| 45-A  | A mistaken deletion or corrupting write to their notes is recoverable — the note history can be restored to any point in the last 35 days | Done | — |
| 45-B  | Their Google/Outlook/MCP sign-ins survive a data-loss incident — no forced re-consent for everyone; core tables can't be dropped by accident | Not Started | — |
| 45-C  | An image they overwrote or deleted in a note can be recovered | Not Started | — |
| 45-D  | Faster recovery after an incident — read views restore in seconds instead of a full history replay | Not Started | 45-A |
| 45-E  | A documented, tested way back after a disaster — scheduled off-table backups plus a written restore runbook with recovery targets | Not Started | 45-A, 45-B |

45-A is the keystone (the event store is the only irreplaceable store — everything else rebuilds from it) and ships first. 45-B–45-E harden the remaining durable stores and add operational backup on the proven pattern. 45-D is lower-priority (those tables rebuild from the event store; PITR only buys restore speed).

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

### Slice 45-B — Protect the sign-in tokens and lock the core tables

- **User value:** Losing the stored Google/Outlook/MCP tokens would force every user to reconnect their calendar and re-authorise. These tables are irreplaceable (the tokens aren't re-derivable) and today have no recovery and no guard against an accidental table drop.
- **How it works:**
  - The token stores gain point-in-time recovery, like the note history.
  - The note-history store and the token stores gain deletion protection, so they can't be dropped by a stray console/CLI action even by an operator.
  - No user-visible change.
- **Scenarios (GWT):**

```
Scenario: Token stores are recoverable
  Given the deployed infrastructure
  When  each auth/calendar/MCP token store is inspected
  Then  point-in-time recovery is enabled on it

Scenario: Core tables cannot be accidentally dropped
  Given the deployed infrastructure
  When  the note-history store and each token store are inspected
  Then  deletion protection is enabled on them
```

### Slice 45-C — Versioning for uploaded note images

- **User value:** A note image that gets overwritten or deleted is currently unrecoverable — the bucket keeps only the latest object. Versioning keeps prior copies so an accidental overwrite or delete can be rolled back.
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

Context: this is pure infrastructure — no aggregates, events, projections, or API routes. The "spec" for each slice is a set of `Infrastructure.Assertions` CDK-template assertions. Every slice touches the deploy path via `cdk deploy`; state the deploy-time delta in the PR. Enabling PITR / versioning / a backup plan is a **one-off stack-update cost**, negligible recurring spend on PAY_PER_REQUEST tables — no bake/canary, deploy-time impact **neutral**.

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
- **Change:** add PITR to `notetaker-auth-tokens`, `notetaker-calendar-tokens`, `notetaker-mcp-refresh-token`; add `DeletionProtection = true` to those three plus `notetaker-events`.
- **Note:** DeletionProtection on a table is a separate control from CloudFormation `DeletionPolicy: Retain` — Retain guards a stack delete; DeletionProtection guards a direct `DeleteTable` API call.
- **Tests:** per-table `..._HasPointInTimeRecovery` / `..._HasDeletionProtection` assertions mirroring 45-A.
- **Acceptance criteria:**
  - [ ] All three token tables synthesise with PITR enabled.
  - [ ] Event store + three token tables synthesise with `DeletionProtectionEnabled = true`.
- **Deploy-time:** neutral.

### 45-C
- **Change:** `NoteImagesBucket` — `Versioned = true`; add a `LifecycleRule` with `NoncurrentVersionExpiration = Duration.Days(<N>)` (choose a bounded window, e.g. 30–90 days) alongside the existing incomplete-multipart-abort rule. `RemovalPolicy.RETAIN` / `AutoDeleteObjects = false` unchanged.
- **Tests:** assert the bucket has `VersioningConfiguration.Status = Enabled` and a non-current-version expiration lifecycle rule.
- **Acceptance criteria:**
  - [ ] `NoteImagesBucket` synthesises with versioning enabled.
  - [ ] Non-current versions expire after the bounded window.
- **Deploy-time:** neutral. (`RecordingsBucket` deliberately excluded — ephemeral working artefact, DESTROY + 7-day expiry.)

### 45-D
- **Change:** add PITR to every `notetaker-proj-*` projection table (`notetitlelist`, `notedetail`, `noteactions`, `todolist`, `notecardlist`, `foldertree`, `tagindex`, `tagfeedback`, `actionfeedback`, `notesearchview`, `workspacelist`). `calendarlinkindex` already has it.
- **Rationale:** these rebuild from the event store via `ProjectionRebuildHandler`, so PITR is a recovery-*speed* optimisation, not a correctness requirement — hence lower priority than 45-A/45-B.
- **Tests:** parameterised assertion that every `notetaker-proj-*` table has PITR enabled.
- **Deploy-time:** neutral.

### 45-E
- **Change:** an `AWS::Backup` plan + dedicated vault selecting the durable tables (event store + token tables; optionally the images bucket) on a schedule with longer retention than the 35-day PITR window; optional cross-region copy action. New CDK constructs (`Amazon.CDK.AWS.Backup`).
- **Docs:** new `docs/observability.md` sibling or `docs/disaster-recovery.md` runbook — state RPO/RTO targets and the step-by-step restore procedure for (a) PITR restore-to-new-table + cutover, (b) AWS Backup recovery-point restore.
- **Tests:** assert the backup plan + vault exist and select the durable tables; assert a schedule rule.
- **Deploy-time:** the backup **jobs** run out-of-band (not in the deploy); the plan is a one-off stack addition — neutral deploy-time.
- **Decision to confirm at slice start:** whether an off-table/cross-region plan is warranted for a single-user app, or whether 45-A–45-D (PITR + versioning) already meet the durability bar. Match resilience cost to scale (see the deploy-time-is-a-first-class-cost guardrail).
