---
name: dynamodb-event-append
description: Canonical pattern for appending events to the DynamoDB event store with optimistic concurrency control. Use when implementing a new event append path, debugging concurrency conflicts, or when writes to the event store are needed. Triggers include "append event", "write to event store", "concurrency conflict", "stream version".
---

# DynamoDB Event Append

This skill applies the canonical append pattern. All writes to the event store go through this path. Direct DynamoDB writes outside `src/EventStore/` are forbidden — see `CLAUDE.md` guardrails.

## Storage layout

Single DynamoDB table — single-table design.

- **Partition key (PK):** stream ID (e.g. `note#<noteId>`)
- **Sort key (SK):** sequence number, zero-padded (`v00000001`, `v00000002`, …)
- **Attributes:** `EventType`, `EventVersion`, `Payload` (JSON), `Timestamp`, `Metadata` (JSON)
- **Stream version stub item:** SK `META#stream`, holding the current head sequence number for fast reads.

## Append algorithm

Given: a stream ID, an expected current version, and one or more events to append.

1. Build a `TransactWriteItems` request:
   - **One Put per event** at SK `v00000<expected+1>`, `v00000<expected+2>`, …
   - **One ConditionCheck** on the META item: `currentVersion = expected`.
   - **One Update** on the META item to set `currentVersion = expected + count`.
2. Execute as a single transaction. If the ConditionCheck fails, throw `ConcurrencyConflictException`.
3. The caller decides whether to retry (re-read stream, re-decide, re-append) or surface the conflict.

## Read algorithm

Given: a stream ID.

1. Query items with PK = stream ID, SK begins with `v`.
2. Deserialise into typed events using `EventType` + `EventVersion`.
3. Return ordered list of events.

## Constraints

- **Atomic transactions only.** No append should leave the store in a partial state.
- **No cross-stream transactions.** A single append touches one stream only.
- **Idempotency keys** on commands when needed — store the last-handled command ID on the META item to suppress duplicate appends from at-least-once delivery.

## Don't

- Don't bypass the ConditionCheck on the META item — that is the optimistic concurrency guard.
- Don't write directly to the table from outside `src/EventStore/`.
- Don't put domain logic here — appends are mechanical; the decision was already made by the aggregate.
