# Clearing the event store in a test harness must also reset the projector's processed-position store

## The trap (BUG-39)

The deploy gate's `clear-test-data` action wiped `notetaker-events` + the projection tables but **not** `notetaker-proj-position` (the projector's per-stream processed-sequence store). That made `TodoReorderJourney` fail **deterministically and only in the deployed env**:

```
Projector skip todo-order#__default__ at 1: position_guard
```

## Why it bites only stable-id streams, only in the async/deployed env

- The projector has a **position guard**: for each stream it only applies events with `SequenceNumber > lastProcessedSeq` (`StreamProjector.ProcessOneAsync`). This is the redelivery-safety mechanism.
- Clearing **events** but not **positions** leaves a stale `lastProcessedSeq` behind.
- For an **entity stream** (`note#<guid>`, `todo#<guid>`) this is harmless — every test run uses a **fresh guid**, so the stream id never collides with a prior run's position mark.
- For a **stable-id stream** it's fatal. The default workspace's order stream `todo-order#__default__` (and any `__default__`-keyed stream) is **reused every run**. After the events are cleared, the next run re-appends its first event as **seq 1** — but `lastProcessedSeq` is still **1** from a prior run, so `1 ≤ 1` → the projector **skips the event as an already-seen duplicate**. The write is silently never projected.
- The **in-process sync projector + in-memory store** (Api.Integration `TodoReorderTests`) can't reproduce it: it applies on append with no persisted position store and no cross-run state. So every test below the deploy-gate E2E passes — the documented "in-memory double hides the gap" guardrail, here for the *position store* rather than a field mapping.

## The rule

**Any harness or operation that truncates the event store must also truncate the processed-position store (and every projection table), or stable-id streams will be silently skipped on the next append.** Treat `proj-position` as part of "the event-sourced state" — it is not optional cleanup. A partial reset is worse than none: it produces a deterministic, deployed-only, "write is lost" failure that looks like a product bug.

## The debugging lesson

This cost a long chase because the symptom ("reorder reverts after reload") screamed *product bug* and correlated with an unrelated frontend slice (the next deploy in line). What cracked it in minutes was the **deployed projector log** — `position_guard` skip named the exact mechanism. When a failure is deterministic, deployed-only, and the code reads correct, **get the runtime logs of the actual component before theorising further** (the E2E env is a separate AWS account — use the `test` profile, account 739754704263, log group `NoteTakerStack-ProjectorFunctionLogGroup*`). A correlation with "the commit it went red on" can be coincidental when a *prior* run set the poisoning state. See [[act-on-red-builds-dont-wait]].
