---
name: aggregate-command
description: Add or modify a command on a domain aggregate, including new event types, the command handler, and wiring. Triggered after an event-modelling spec exists and an implementation is needed. Use when the user asks to "implement this command", "add a new event to <aggregate>", or to make a failing BDD spec pass.
---

# Aggregate Command Implementation

This skill implements a command handler on an aggregate so that an existing BDD spec passes green.

## Pre-conditions

- A failing BDD spec exists in `tests/Specs/<Aggregate>/`.
- The event model in `docs/event-model.md` is up to date.
- Aggregates are pure — no I/O, no clock, no DB. They take prior events plus a command and return new events or throw a domain exception.

## Steps

1. **Locate or create the aggregate** in `src/Domain/<Aggregate>/`. Each aggregate has:
   - State record (private constructor, rebuilt by folding events)
   - Command record(s)
   - Event record(s)
   - Static `Decide(state, command) -> events` function
   - Static `Apply(state, event) -> state` function

2. **Add new event records** to `src/Domain/<Aggregate>/Events/`. Events are immutable records. Once a version ships, never edit shape — version it (e.g. `ContentAppendedV2`).

3. **Extend `Apply`** to handle each new event type. Keep folds total — every event the aggregate could see must produce a state.

4. **Extend `Decide`** to handle the new command:
   - Validate against current state
   - Throw a typed domain exception on violation (matches the spec's `ThenThrows<>`)
   - Return new events on success

5. **Run the spec.** It should now pass green. If it doesn't, fix the implementation, not the spec.

6. **Wire the command into the API** in `src/Api/` only after the domain spec passes. The API layer:
   - Accepts the command DTO
   - Loads prior events from the event store (use the **dynamodb-event-append** skill)
   - Calls `Decide`
   - Appends new events
   - Returns appropriate HTTP response

7. **Update relevant projections** if events affect a read model (use the **projection** skill).

## Don't

- Don't add I/O, time, or randomness to the aggregate. Pass them in or generate them at the API layer.
- Don't mutate state — build new state records.
- Don't change a published event's shape. Version it.
- Don't skip the API wiring step — but don't do it before the domain spec is green.
