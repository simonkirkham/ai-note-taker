# ADR 0011 — Transcription checkpoints are draft state, not events (overwrite-in-place draft store)

**Status:** Accepted

**Date:** 2026-06-05

## Context

Phase 10 transcription streams speech to text in the browser and, on **Stop**, POSTs the full transcript to `POST /notes/{id}/transcription`, which issues `CompleteTranscription` → a `TranscriptionCompleted` event (a full snapshot; the aggregate replaces `_transcriptText`). The transcript was persisted **only at that terminal point**, so pressing back / closing the tab / crashing mid-call lost the entire in-progress transcript (the "Back button bug").

The immediate fix added two things on the frontend: a flush on unmount, and a **15s autosave** that re-POSTs the accumulated transcript while recording. That autosave is a stopgap with a structural problem: it emits a `TranscriptionCompleted` event **every ~15s of speech**, putting disposable, last-wins working state into the permanent, replayed-forever event log.

The question this ADR settles: **should interim transcription checkpoints be events at all?**

The deciding fact is local to this codebase: the event store is **snapshot-less**. Every command reloads and replays the *entire* stream — every command handler does `store.ReadAsync(streamId)` with no from-version or snapshot. So each checkpoint event is re-read and re-deserialized on **every future operation** against that note, forever. A one-hour meeting at 15s cadence is ~240 superseded transcript blobs (each up to tens of KB) permanently welded to the stream and re-read on every rename, edit, tag, or analyse.

## Decision

**No. Interim transcription checkpoints are draft / working state, not domain events.**

- Checkpoints are written to a dedicated **overwrite-in-place draft store**, keyed per note (one item per note, owning user recorded and ownership enforced at the API boundary) — each checkpoint overwrites the last.
- The **event log records exactly one `TranscriptionCompleted` per recording**, on a clean stop.
- A draft is **promoted** to that single event (and then deleted) when the recording ends — either cleanly (Stop / intentional navigation away) or via **explicit recovery** after an interrupted session (crash, tab close, power loss).

This supersedes the checkpoint-as-`TranscriptionCompleted` stopgap.

### Why a checkpoint is not an event

| A domain event is… | A transcription checkpoint is… |
|---|---|
| A fact worth keeping forever | Explicitly disposable — only the latest matters |
| The record of a decision / intent | Pure timer output; no decision |
| Reacted to by consumers/projections | Read by nothing but crash recovery |
| Auditable, temporally queryable | Nobody asks "what was the transcript at minute 12" |
| Cheap to replay | Re-read on every command in a snapshot-less store |

Two concerns were being conflated: the **domain fact** ("a transcript was completed for this note" → `TranscriptionCompleted`, one per recording) and **working state** (the in-progress transcript autosaved for crash recovery). Only the first belongs in the log.

## Design

- **Draft store.** A new DynamoDB table, one item per note (keyed by the note id; the owning user is recorded as an attribute and ownership is enforced at the API boundary), overwritten on each checkpoint, with a **TTL** so abandoned drafts self-clean. It is neither the event store nor a projection but a sanctioned third category — *loss-tolerant working state*. It lives in the `EventStore` project alongside the projections (so the "never write to DynamoDB outside `src/EventStore/`" guardrail still holds) but is documented as a non-event store. Ownership-scoped like every other store.
- **Endpoints.**
  - `PUT /notes/{id}/transcription/draft` — idempotent overwrite of the draft. **Emits no event.** Called on the checkpoint timer.
  - `DELETE /notes/{id}/transcription/draft` — discard an uncommitted draft (recovery "Discard"). Emits no event.
  - `POST /notes/{id}/transcription` — **unchanged contract**, still emits `TranscriptionCompleted`; now also **deletes the draft**. Called on clean Stop and on recovery commit.
  - `GET /notes/{id}` — surfaces an **uncommitted** draft (composed at read time, not stored in the projection) so the UI can offer recovery on reload.
- **Frontend.** The checkpoint timer `PUT`s the draft instead of POSTing the event. Clean Stop and intentional navigation away still **commit** (POST → event + draft delete). The draft is only the safety net for *unexpected* loss. On opening a note with an uncommitted draft, the UI offers Recover / Discard (confirmed in the Phase 18 Scout brief).

## Consequences

- **Event stream stays one-`TranscriptionCompleted`-per-recording.** Replay cost is bounded; the model is honest.
- **The authoritative transcript still lives only in the event log.** The draft is a recovery buffer that is allowed to be lost, so the project invariants ("projections rebuildable from the full stream", "no authoritative state outside the log") are preserved — the draft is not authoritative state, and is composed into `GET /notes/{id}` at read time rather than stored in a projection.
- **New infrastructure.** A new table, IAM grants, and CDK + `Infrastructure.Assertions` wiring; new endpoint contracts; a recovery UX. More moving parts than the stopgap.
- **DynamoDB 400 KB item limit caps a single draft.** For expected meeting lengths (sub-400 KB ≈ tens of thousands of words) this is fine. If transcripts can exceed it, the escape hatch is to store the draft *body* in S3 and keep only a pointer in the item (see *Revisit when*).
- **Stale-draft-after-failed-delete** is possible if `POST` commits the event but the draft delete fails. Guard at recovery: if the draft equals / is a prefix of the committed transcript, treat it as committed and do not offer it. The recovery Discard control is the manual backstop.
- **Checkpoint cadence is now free to tune** (15s, or tighter) without touching the event log — drafts are cheap overwrites, not appends.

## Alternatives considered

- **A — repeat `TranscriptionCompleted` every checkpoint (the current stopgap).** Zero new infrastructure and trivially correct on replay (last-write-wins), but permanently bloats a snapshot-less stream and is a semantic lie (an event named *Completed* firing mid-recording). Acceptable only as a stopgap. **Rejected as the permanent solution.**
- **B — a distinct `TranscriptionCheckpointed` event.** Names the interim/terminal split honestly, but the checkpoints are **still in the log and still replayed forever** — it does not fix the cost, only the naming. It also introduces a `Checkpointed`-after-`Completed` precedence/ordering problem (a late checkpoint overwriting the final text) that needs explicit guard logic in the aggregate. More work, same core problem. **Rejected.**
- **S3 draft object instead of a DynamoDB item.** Sidesteps the 400 KB limit and is cheap, but adds a second storage system for no benefit at expected transcript sizes. **Rejected now; retained as the >400 KB escape hatch.**
- **No checkpoints — only flush-on-unmount.** Simplest, and handles intentional navigation, but a hard crash or power loss still loses everything since unmount never runs. **Rejected** — crash resilience is the entire point.

## Revisit when

- Transcripts routinely approach the **400 KB** DynamoDB item limit → move the draft *body* to S3, keep a pointer in the item.
- A **second kind of ephemeral working-state** appears (e.g. draft note content) → generalise the draft store rather than add a parallel one.
- The event store gains **snapshotting** → the replay-cost argument weakens, but the "checkpoints aren't facts" argument stands; do not move checkpoints back into the log on that basis alone.
