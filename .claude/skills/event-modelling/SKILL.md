---
name: event-modelling
description: Translate a Given/When/Then event-modelling sketch into a plain C# BDD spec file. Use whenever a new command, event, or slice is being added — before any implementation code. Triggers include "new spec", "add a Given/When/Then", "event model says", "translate this slice".
---

# Event Modelling → BDD Spec

This skill turns a hand-drawn or text-form event-modelling slice into a runnable BDD spec.

## Inputs you should already have

- The aggregate name (e.g. `Note`)
- The command being introduced (e.g. `AppendContent`)
- Prior events (the *Given*) — may be empty for the first command on a new aggregate
- The expected new events (the *Then*) — may also be a domain error
- Any pre-conditions on aggregate state

## Steps

1. Confirm the aggregate exists in `src/Domain/`. If not, scaffold it first using the **aggregate-command** skill before continuing.
2. Update `docs/event-model.md` — add the new command and any new events to the table.
3. Create or extend `tests/Specs/<Aggregate>/<Command>Specs.cs`.
4. For each scenario, write a test method using the project's spec helpers:

   ```csharp
   [Fact]
   public void Appends_content_to_existing_note() =>
       Given(new NoteCreated(noteId, now, "Standup"))
           .When(new AppendContent(noteId, "discussed roadmap"))
           .Then(new ContentAppended(noteId, now, "discussed roadmap"));
   ```

5. For domain errors:

   ```csharp
   [Fact]
   public void Cannot_append_content_to_deleted_note() =>
       Given(
           new NoteCreated(noteId, now, "Standup"),
           new NoteDeleted(noteId, now))
           .When(new AppendContent(noteId, "anything"))
           .ThenThrows<NoteDeletedException>();
   ```

6. Run the spec — it should fail (red), not pass accidentally. Confirm the failure message points at missing implementation, not a test bug.
7. Hand off to the **aggregate-command** skill to implement.

## Don't

- Don't write any implementation in this skill. Specs only.
- Don't skip updating `docs/event-model.md` — the model and the spec must move together.
- Don't combine multiple slices into one spec — one command per spec file.
