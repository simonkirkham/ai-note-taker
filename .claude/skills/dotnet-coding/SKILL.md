---
name: dotnet-coding
description: Project-specific C# coding conventions for this event-sourced notes app. Covers aggregate purity, command handler pattern, event immutability, and no-comments rule. Load before writing any C# in src/.
---

# .NET Coding — Project Conventions

## When to load

Load before writing or reviewing any C# file in `src/`. This skill overrides generic .NET guidance where project rules differ.

## Project-specific rules (non-negotiable)

These override or extend the standard guide in `docs/dotnet-coding-standards.md`.

**Aggregate purity**
- Aggregates live in `src/Domain/`. They must have no side effects, no DB calls, no clock access.
- Pass `DateTime` and generated IDs in from outside (command handler or test).
- If you find yourself writing `DateTime.UtcNow` or `Guid.NewGuid()` inside an aggregate method, stop — move it to the caller.

**Command handler owns orchestration**
- Each aggregate gets one `*CommandHandler` in `src/Api/`. The handler does exactly this:
  1. Load the event stream from the store
  2. Rebuild the aggregate by replaying events
  3. Execute the command (aggregate produces new events)
  4. Append new events to the store
  5. Update projections
- API endpoints do HTTP only: parse the request, call the handler, return the result. Never write `store.ReadAsync` or `store.AppendAsync` inside an endpoint lambda.

**Events are immutable**
- Once an event shape is in production, never change it. Introduce a new event type (e.g. `NoteContentSetV2`) instead.
- Wire shapes for events live in `docs/event-schemas.md`. Update there first.

**Projections are rebuildable**
- No state lives only in a projection. Every projection must be derivable from a full replay of the event stream.
- Rebuild logic belongs in `*Projection.cs` in `src/EventStore/Projections/`.

**No DynamoDB access outside the event store**
- Never call DynamoDB APIs directly from `src/Api/` or `src/Domain/`.
- All store access goes through the helpers in `src/EventStore/`.

**No comments (CLAUDE.md rule)**
- Do not add XML doc comments (`///`) or inline comments by default.
- Add a comment only when the WHY is non-obvious: a hidden constraint, a subtle invariant, a workaround for a known bug. If removing it wouldn't confuse a future reader, don't write it.
- This overrides the generic .NET standard that recommends XML doc comments on public APIs.

## Standard rules (abbreviated)

These apply when the project-specific rules above don't say otherwise.

- `PascalCase` for public types and members; `camelCase` for private fields and parameters.
- File-scoped namespaces: `namespace My.App;`
- `var` when the type is obvious from the right-hand side (`var x = new Foo()`); explicit types otherwise.
- Prefer expression-bodied members for short forwarders/accessors.
- `async`/`await` for all I/O-bound work; never `.Result` or `.Wait()`.
- Only catch exceptions you can handle — no broad `catch (Exception)` without justification.

Full reference: `docs/dotnet-coding-standards.md`

## Checklist (run before opening a PR)

- [ ] Aggregate has no side effects, no DB calls, no clock access — time and IDs passed in from outside
- [ ] Command handler follows load → rebuild → execute → append → project sequence
- [ ] Endpoint lambda does HTTP only — no `store.ReadAsync` or `store.AppendAsync`
- [ ] Events are immutable — any shape change is a new event type, not an edit
- [ ] No DynamoDB access outside `src/EventStore/`
- [ ] Each class and interface is in its own file; filename matches the type name exactly
- [ ] Names: PascalCase for public types/members, camelCase for params/locals
- [ ] File-scoped namespace used
- [ ] `var` only when type is obvious from right-hand side
- [ ] No comments added unless the WHY is non-obvious
- [ ] No broad `catch (Exception)` blocks without justification
- [ ] `dotnet format` passes

## Commands

```bash
dotnet build ai-note-taker.sln          # builds and emits analyzer diagnostics
dotnet test tests/Specs/Specs.csproj    # domain BDD specs
dotnet format                           # auto-fix formatting
```
