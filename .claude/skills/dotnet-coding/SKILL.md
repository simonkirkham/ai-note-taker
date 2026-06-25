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

**DRY — avoid duplication**
- Extract shared logic rather than copy-pasting. If you find yourself writing the same pattern twice, it belongs in a helper or base method.

**Size limits (smells, not hard rules)**
- Classes over ~100 lines are a signal to look for a seam to split on. Ask: does this class have more than one reason to change?
- Methods over ~15 lines should be broken into smaller, well-named private methods. Prefer many short methods that read like prose over one long method that requires comments.
- Classes with more than 2–3 constructor dependencies are a smell. Consider splitting responsibilities or introducing a facade.

**Naming**
- Prefer longer, fully descriptive names over short or abbreviated ones. A name should read as a sentence fragment that explains intent — never sacrifice clarity for brevity.

**Unused `using` directives**
- Remove all unused `using` directives before committing. `dotnet format` will flag them; treat them as errors.

**Guard clauses — exit early, reduce nesting**
- Return or throw at the top of a method for invalid/edge-case inputs. The happy path should be the un-indented path.
- Never wrap the main body of a method in an `if` block when an early return would serve.
```csharp
// smell
if (user != null) { if (user.IsActive) { /* main logic */ } }

// better
if (user is null) return;
if (!user.IsActive) return;
// main logic here, un-indented
```

**Rethrowing exceptions — use `throw;` not `throw ex;`**
- `throw ex;` resets the stack trace, losing the original call site. `throw;` preserves it.
- Only rethrow via `throw;` (bare) inside a `catch` block.

**`nameof()` for parameter references in exceptions**
- Never hard-code parameter names as string literals. `nameof()` is refactor-safe and caught by the compiler.
```csharp
ArgumentNullException.ThrowIfNull(input, nameof(input));   // good
throw new ArgumentNullException("input");                   // smell — string will go stale on rename
```

**Switch expressions over switch statements when returning a value**
- Use a switch expression (`x switch { ... }`) wherever a switch is computing a result. Eliminates `break`, reduces duplication, reads as a table.
```csharp
// statement (verbose)
string label;
switch (status) { case 1: label = "Active"; break; default: label = "Unknown"; break; }

// expression (clean)
var label = status switch { 1 => "Active", _ => "Unknown" };
```

**`using` declarations for `IDisposable`**
- Prefer `using var x = ...;` over `using (var x = ...) { }` blocks. The resource disposes at end of enclosing scope — less nesting, same safety.
```csharp
using var stream = File.OpenRead(path);   // disposes when method exits
```

**Interfaces on all injectable services**
- Every class registered with DI should have a corresponding interface, even when there is only one implementation today. The interface is the seam for testing and future swapping.

**`sealed` on all concrete classes not designed for inheritance**
- Explicitly mark concrete classes `sealed` unless inheritance is an intentional part of the design. Makes intent clear; prevents accidental subclassing.

**`async void` only for event handlers — never otherwise**
- `async void` methods cannot be awaited. Any exception they throw is unobservable and will crash the process. Always return `async Task` instead.
- The sole exception is framework event handlers (e.g. button click handlers) where the signature is imposed.

**Interfaces and abstract classes each get their own file**
- Interfaces (`I*.cs`) and abstract classes must never be grouped with other types. Pure data records may be grouped (see checklist item above); interfaces and abstracts may not.

**Group classes by type into folders**
- Classes of the same kind live together in a named subfolder, not scattered at the project root. This makes it immediately obvious where to find or add a given type.
- Canonical folder names for this project:

| Folder | What goes there |
|---|---|
| `CommandHandlers/` | `*CommandHandler` classes and their interfaces |
| `Endpoints/` | Minimal API endpoint mapping classes |
| `Handlers/` | HTTP-level request handlers (static methods called from endpoints) |
| `Projections/` | `IDomainEventHandler` implementations that update read models |
| `EventHandlers/` | Other domain event handler infrastructure |
| `Contracts/` | API request/response record types |
| `Exceptions/` | Custom exception classes |

- Do not place implementation classes directly in the project root. If a new type doesn't fit an existing folder, create a descriptively named one rather than dropping it at root level.

Full reference: `docs/dotnet-coding-standards.md`

## Checklist (run before opening a PR)

- [ ] Aggregate has no side effects, no DB calls, no clock access — time and IDs passed in from outside
- [ ] Command handler follows load → rebuild → execute → append → project sequence
- [ ] Endpoint lambda does HTTP only — no `store.ReadAsync` or `store.AppendAsync`
- [ ] Events are immutable — any shape change is a new event type, not an edit
- [ ] No DynamoDB access outside `src/EventStore/`
- [ ] Each class and interface is in its own file; filename matches the type name exactly. Exception: simple records with no behaviour (commands, events, API request/response contracts) may be grouped into one logical file per area (e.g. `NoteCommands.cs`, `NoteEvents.cs`) — only when every type in the file is a pure record with no implementation body.
- [ ] Names: PascalCase for public types/members, camelCase for params/locals; descriptive over brief
- [ ] File-scoped namespace used
- [ ] `var` only when type is obvious from right-hand side
- [ ] No comments added unless the WHY is non-obvious
- [ ] No broad `catch (Exception)` blocks without justification — but for every new AWS SDK service call, add a targeted catch for the service-specific exception type (e.g. `AmazonSecurityTokenServiceException`, `AmazonBedrockRuntimeException`) and map it to a 503 `Results.Problem`; do not let raw AWS exceptions propagate as 500s
- [ ] No duplicated logic — shared code extracted to a helper or method
- [ ] No class longer than ~100 lines without a clear reason
- [ ] No method longer than ~15 lines — extract and name sub-steps
- [ ] No class with more than 2–3 constructor dependencies — split responsibilities if so
- [ ] No unused `using` directives
- [ ] Guard clauses used at method entry — no main logic wrapped in an `if` when an early return would do
- [ ] Rethrowing uses bare `throw;` not `throw ex;`
- [ ] Parameter names in exceptions use `nameof()` not string literals
- [ ] Switch that returns a value uses a switch expression, not a switch statement
- [ ] `IDisposable` resources use `using var` declarations, not `using (...)` blocks
- [ ] Every DI-injectable class has a corresponding interface
- [ ] All concrete classes are `sealed` unless inheritance is explicitly intended
- [ ] No `async void` outside of framework event handlers
- [ ] Each interface and abstract class is in its own file
- [ ] Classes are grouped by type in named subfolders — no implementation classes at project root
- [ ] `dotnet format` passes

## Commands

```bash
dotnet build ai-note-taker.sln          # builds and emits analyzer diagnostics
dotnet test tests/Specs/Specs.csproj    # domain BDD specs
dotnet format                           # auto-fix formatting
```
