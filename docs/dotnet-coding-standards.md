# .NET / C# Coding Standards (summary)

## Project-specific rules

These apply to this codebase and override standard guidance where they conflict.

### Aggregate purity
Aggregates in `src/Domain/` must have no side effects, no DB calls, and no clock access. Pass `DateTime` and generated IDs in from the command handler or test. Never call `DateTime.UtcNow` or `Guid.NewGuid()` inside an aggregate method.

### Command handler orchestration
Each aggregate gets one `*CommandHandler` in `src/Api/`. The handler owns this exact sequence:
1. Load the event stream from the store
2. Rebuild the aggregate by replaying events
3. Execute the command (aggregate produces new events)
4. Append new events to the store
5. Update projections

API endpoints do HTTP only — parse the request, call the handler, return the result. Never write `store.ReadAsync` or `store.AppendAsync` inside an endpoint lambda.

### Event immutability
Once an event shape is in production, never edit it. Introduce a new event type instead (e.g. `NoteContentSetV2`). Wire shapes live in `docs/event-schemas.md` — update there first.

### No DynamoDB access outside the event store
All DynamoDB access goes through `src/EventStore/`. Never call DynamoDB APIs from `src/Api/` or `src/Domain/`.

### Comments — no-comments convention (overrides XML doc comment guidance)
Do not add XML doc comments (`///`) or inline comments by default. Add a comment only when the WHY is non-obvious: a hidden constraint, a subtle invariant, or a workaround for a specific bug. If removing the comment wouldn't confuse a future reader, don't write it. **This overrides the standard .NET recommendation below that suggests XML doc comments on public APIs.**

---

This document collects widely-adopted .NET and C# coding conventions and links to official guidance. Use it as the team's starting point; prefer the linked authoritative sources for edge cases.

Sources

- Microsoft: C# Coding Conventions — https://learn.microsoft.com/dotnet/csharp/fundamentals/coding-style/coding-conventions
- Microsoft: Framework Design Guidelines — https://learn.microsoft.com/dotnet/standard/design-guidelines/
- .NET Runtime style rules (examples and rules used in runtime projects) — https://github.com/dotnet/runtime/blob/main/docs/coding-guidelines/coding-style.md
- Roslyn / compiler contributor guidelines (naming, diagnostics) — https://github.com/dotnet/roslyn/blob/main/CONTRIBUTING.md

Principles

- Correctness: prefer clear, correct code over micro-optimisations unless implementing hot-path code.
- Consistency: follow a shared style so diffs are easier to review.
- Modern idioms: prefer current language features where they improve clarity (pattern matching, target-typed new, raw string literals, `async`/`await`).
- Tooling: enforce style with `.editorconfig`, Roslyn analyzers, and `dotnet format`.

Key rules (practical subset)

Naming & APIs

- Use PascalCase for public types and members; camelCase for private fields and parameters.
- Avoid abbreviations; choose descriptive names.
- Prefer `I` prefixes for interfaces (e.g., `IRepository`).

File and formatting

- Use file-scoped namespaces: `namespace My.App;`.
- Place `using` directives outside the namespace declaration.
- Indent with 4 spaces; do not use tab characters.
- One statement per line; one declaration per line.
- Use the Allman brace style in examples and samples if the project prefers it; otherwise be consistent across the repo.
- Keep lines reasonably short (wrap long expressions).

Language usage

- Use `var` when the type is obvious from the right-hand side (e.g., `var x = new Foo()`); otherwise prefer explicit types.
- Prefer string interpolation (`$"{name}"`) for short concatenations; use `StringBuilder` for large or repeated concatenations.
- Use `async`/`await` for I/O-bound work; prefer `Task`-returning APIs for async libraries.
- Prefer expression-bodied members for short accessors/forwarders where it improves clarity.

LINQ & collections

- Use meaningful range variable names in query expressions.
- Use implicit typing (`var`) for LINQ range and result variables when it improves readability.

Exception handling

- Only catch exceptions you can handle; avoid catching `Exception` broadly.
- Prefer `using` and `IAsyncDisposable` patterns for resource cleanup; use `using` declaration where appropriate.

Documentation & comments

- Use XML doc comments (`/// <summary>`) for public API members.
- Use `//` for short inline comments; avoid block `/* ... */` comments in code.

Security & correctness

- Follow Microsoft Secure Coding Guidelines: https://learn.microsoft.com/dotnet/standard/security/secure-coding-guidelines
- Validate inputs, avoid security anti-patterns, and use safe APIs for cryptography and secrets management.

Tools and enforcement

- Use an `.editorconfig` at repo root to configure formatting and style rules. Consider adopting the `dotnet/docs` .editorconfig as a starting point.
- Enable Roslyn analyzers (e.g., `Microsoft.CodeAnalysis.FxCopAnalyzers` or `dotnet-format`/`dotnet analyzer`) in CI to fail builds on important rule violations.
- Use `dotnet format` locally or in CI to ensure formatting consistency (this project has no pre-commit hook).

Review & escalation

- If a consensus exception is needed (performance, legacy constraints), document the rationale in a code comment and the PR description.

Examples

- Modern object creation: `var p = new Person("Alice");` or `Person p = new();` when explicit type is helpful.
- File-scoped namespace: `namespace MyCompany.MyProduct;`
- Using placement: `using System;` (outside namespace)

Links and further reading

- C# coding conventions: https://learn.microsoft.com/dotnet/csharp/fundamentals/coding-style/coding-conventions
- Framework design guidelines: https://learn.microsoft.com/dotnet/standard/design-guidelines/
- Runtime coding-style: https://github.com/dotnet/runtime/blob/main/docs/coding-guidelines/coding-style.md
- Roslyn CONTRIBUTING: https://github.com/dotnet/roslyn/blob/main/CONTRIBUTING.md
- EditorConfig reference: https://learn.microsoft.com/visualstudio/ide/create-portable-custom-editor-options
- Secure coding guidelines: https://learn.microsoft.com/dotnet/standard/security/secure-coding-guidelines

How to apply

1. Add or update `.editorconfig` at repo root to enforce formatting rules.
2. Enable code analysis and analyzers in `.csproj` files (treat important rules as errors in CI).
3. Run `dotnet format` and add it to CI pre-checks.
4. Educate reviewers to expect PRs that follow these rules and to push back on style regressions.

Appendix: minimal `.editorconfig` starter

```
root = true
[*.cs]
indent_style = space
indent_size = 4
dotnet_style_qualification_for_field = false:suggestion
dotnet_style_prefer_inferred_tuple_names = true:suggestion
csharp_style_var_when_type_is_apparent = true:suggestion
csharp_style_var_elsewhere = false:suggestion
```

---

This summary is intentionally concise. Use linked pages for full authoritative guidance and examples.
