# Learnings: 1-B — IEventStore OCC Contract

## What was inefficient or went wrong

- Pip jumped straight to implementation without being asked — the human had to interrupt mid-edit to enforce the pipeline gate. The CLAUDE.md guardrail was only added *after* the violation, not before.
- The new guardrail ("never begin a role without explicit human naming") was immediately contradicted by the human ("automate the Pip→Hawk handoff"). The rule was written too broadly without considering well-defined automatic triggers defined by the workflow.

## Suggested process improvements

- **Pip** should treat the workflow gate as a hard stop: confirm the role with the human before writing a single line, even when the next step is unambiguous.
- **CLAUDE.md guardrail** should be updated to carve out automatic transitions that are already specified by the workflow (e.g. CI green → Hawk review), so the rule is precise rather than blanket.
- **Breaker** should include a spec for multi-event batch appends and for reading a non-existent stream when specifying the `IEventStore` OCC contract — these are part of the observable contract and were left unspecified.

## Hawk review findings

| Finding | File | How to prevent |
|---|---|---|
| No spec for multi-event batch append | `tests/Specs/EventStore/EventStoreSpec.cs` | Breaker should enumerate all observable behaviours of the interface, including batch appends |
| No spec for reading a non-existent stream | `tests/Specs/EventStore/EventStoreSpec.cs` | Breaker should specify all boundary conditions for `ReadAsync` |
| `AsReadOnly()` wraps live list, not a snapshot | `tests/Specs/EventStore/InMemoryEventStore.cs:28` | Pip should use `.ToList().AsReadOnly()` for test doubles that return collections |
| CLAUDE.md guardrail contradicts user's automation intent | `CLAUDE.md` | Scribe/human should review guardrail wording at slice end and tighten scope |
