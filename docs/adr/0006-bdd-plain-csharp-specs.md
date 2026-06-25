# ADR 0006 — BDD with plain C# Given/When/Then specs

**Status:** Accepted

## Context

Want BDD-style tests from day one, driven by event modelling. Two main flavours in .NET:

- **Reqnroll** (community continuation of SpecFlow) — Gherkin `.feature` files, scenario syntax, tooling support.
- **Plain C# Given/When/Then specs** — helper methods like `Given(events).When(command).Then(expectedEvents)`.

## Decision

Use **plain C# Given/When/Then specs** built on xUnit. No Gherkin layer.

## Consequences

- Specs map 1:1 to the event model: *Given* prior events, *When* a command, *Then* expected new events.
- Tight feedback loop — no Gherkin parser, no `.feature` file maintenance.
- Specs read close to the event-model diagrams.
- Specs become the success criterion handed to coding agents — they iterate until specs pass green.
- Trade-off: specs are not readable by non-developers. Acceptable — this is a solo learning project. Reqnroll could be layered on later if the audience changes.

## Alternatives considered

- **Reqnroll** — better for cross-functional readability; not needed here.
- **Plain xUnit without BDD helpers** — works, but loses the readable Given/When/Then structure that makes event-sourcing tests easy to scan.
