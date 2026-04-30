---
name: refactor
description: Clean up code after specs pass — improve structure, readability, and event-sourcing alignment without changing behaviour. Run after all BDD specs are green, before opening a PR. Triggers include "refactor", "clean up", "tidy", "code smell".
---

# Refactor

Run this skill after all BDD specs pass and before opening a PR. Behaviour must be fully preserved — the spec suite is the safety net.

## Golden rules

1. **Behaviour is preserved.** Every change affects implementation only, never observable outcome. Specs must still pass after every step.
2. **Small steps.** One improvement at a time. Re-run specs between steps.
3. **One concern at a time.** Don't mix a rename with an extract — separate commits are fine.
4. **Don't refactor red.** If specs are failing, fix them first. Refactoring on a red suite hides regressions.
5. **Stop when specs break.** Revert and try a smaller step.

## Process

1. **Read** — scan every file changed in this slice for smells (see below).
2. **List** — write out each smell found, file and line. Don't fix yet.
3. **Prioritise** — fix the highest-signal smells first; skip cosmetic ones if the diff is already large.
4. **Fix one smell at a time** — run `dotnet test` (or `npm test`) after each fix to confirm green.
5. **Stop** — when the list is clear or the diff is large enough. Don't gold-plate.

## Code smells to check

### General

| Smell | Signal | Fix |
|---|---|---|
| Long method | > ~20 lines, multiple levels of indent | Extract to a private method with a name that says *why*, not *what* |
| Duplicated logic | Same expression or block in two places | Extract to a shared private method or a helper class |
| Magic literals | `"note#"`, `"v%08d"`, `1` scattered in code | Named constant or record with a factory method |
| Nested conditionals | `if` inside `if` inside `if` | Guard clauses / early returns |
| Dead code | Unused private methods, `// commented out` blocks | Delete — git has history |
| Long parameter list | > 3–4 parameters in a row | Group into a record or use a builder |
| Primitive obsession | Raw `string` or `Guid` where a domain type exists | Use `NoteId`, `StreamId`, etc. |
| Unclear name | `e`, `item`, `result`, `tmp` | Name what it *is*, not what it *holds* |

### Event-sourcing specific

| Smell | Signal | Fix |
|---|---|---|
| Application logic in endpoint | `store.ReadAsync`, `store.AppendAsync`, or aggregate construction inside an endpoint lambda | Move to the `*CommandHandler` for the aggregate — endpoints do HTTP only |
| Domain logic in handler | `if`/`switch` that *decides* inside an API endpoint or projection | Move decision to the aggregate; handler only orchestrates |
| Event switch without default | `switch (envelope.EventType)` with no `default` or ignored unknown types | Add `default: break` (silent skip) or `default: throw` (strict) — be explicit |
| Projection reading its own store | Projection `Handle` method calls DynamoDB to read state before writing | Fold into in-memory state only; persist after fold |
| Inline deserialisation | `JsonSerializer.Deserialize<NoteCreated>(payload)` scattered across files | Route through `EventDeserializer` — single place to version |
| Append followed immediately by read | `await store.AppendAsync(...)` then `await store.ReadAsync(...)` in the same request | The append already returns the new events; no re-read needed |
| Aggregate state mutation outside `Apply` | `_field = value` inside `Handle` instead of `Apply` | All state changes go through `Apply`; `Handle` emits events only |
| Projection coupled to aggregate namespace | `using Domain.Notes` inside `src/EventStore/Projections/` when only string event types are needed | Check if the coupling is necessary; prefer operating on `EventEnvelope` fields |
| Command validated by projection | Projection data used to enforce an invariant in a command handler | Invariants belong on the aggregate, built from the event stream |

### .NET / ASP.NET specific

| Smell | Signal | Fix |
|---|---|---|
| `async` method with no `await` | Warning CS1998 | Remove `async`/`Task` wrapper or add the missing await |
| `ConfigureAwait(false)` absent in library code | In `src/EventStore/` or `src/Domain/` | Add `ConfigureAwait(false)` to every `await` in library projects |
| Swallowed exception | `catch (Exception) { }` or catch with no rethrow/log | At minimum log; ideally don't catch what you can't handle |
| Nullable reference not checked at boundary | External input (`req.Title`) used without null guard | Add `ArgumentNullException.ThrowIfNull` or null-coalescing at the entry point |

## What NOT to do

- Don't rename things "just because" — a rename is only worth it if the current name is actively confusing.
- Don't introduce abstractions for a single use case (no `ICommandHandler<T>` when there's one handler).
- Don't add comments that restate what the code does — only the *why* earns a comment.
- Don't extract tiny one-line helpers that make the call site harder to read.
- Don't reformat code style unrelated to the slice — keep diffs focused.

## Adding new rules

Add rows to the relevant table above. Include: the smell name, the signal that tells you it's present, and the concrete fix. Keep examples minimal — one bad line and one good line is enough.
