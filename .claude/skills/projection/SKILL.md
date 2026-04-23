---
name: projection
description: Scaffold or extend a read projection over the event stream, including rebuild logic. Use when a new read model is needed, an existing projection needs to react to a new event type, or a projection rebuild is required after an event versioning change. Triggers include "new read model", "projection for", "rebuild projection", "expose <X> to the UI".
---

# Projection

This skill creates or extends a read projection. Projections are derived state — never the source of truth.

## Core principles

- A projection is rebuildable from the full event stream.
- No business logic lives only in a projection.
- Projections can be wrong without the system being broken — they can be torn down and replayed.

## Steps

### Creating a new projection

1. **Decide the read model shape.** What does the UI / API consumer actually need? Keep it narrow — denormalised for the query, not for general purpose.

2. **Create the projection class** in `src/EventStore/Projections/<Name>Projection.cs`. It implements:
   - `Handle(event)` for each event type it cares about
   - `Reset()` to clear state for a rebuild
   - Storage hook (DynamoDB table or in-memory for read-only views)

3. **Add a DynamoDB table** for the projection storage if persistent. Update the CDK stack via the **cdk-stack-update** skill.

4. **Subscribe to the event stream.** New events flow to projections via the event store's subscription mechanism.

5. **Add a query endpoint** in `src/Api/` that reads from the projection (never recomputes from events).

### Extending an existing projection

1. Add the new event handler.
2. Decide whether existing projection state needs rebuilding to backfill the new field. If yes:
   - Document it in `docs/event-model.md`
   - Trigger a rebuild via `Reset()` then replay all events.

### Rebuild logic

Projections must be rebuildable. Steps:

1. `Reset()` clears the projection store.
2. Read all events from the event store, in order.
3. Call `Handle(event)` for each.
4. Mark rebuild complete.

## Don't

- Don't put validation or domain rules in a projection. They belong on the aggregate.
- Don't read from one projection to write another. Both should derive directly from events.
- Don't mutate event store state from a projection.
