# Phase N — <Title> _(Not Started)_

**Goal:** <One user-facing sentence: what the user can now do that they couldn't before. No history, no implementation.>

## Summary

| Slice | What the user gets | Status | Depends on |
|-------|--------------------|--------|------------|
| N-A   | <one line, user terms — no event/projection/endpoint names> | Not Started | — |
| N-B   | <one line, user terms> | Not Started | N-A |

<One line of ordering nuance here if needed — e.g. "N-A proves the flow end-to-end; N-B scales the pattern." No ASCII diagram.>

## Slices

<!-- REVIEW SURFACE — the human reads this and stops. No technical artefact named below. -->

### Slice N-A — <Title>

- **User value:** <one line — why this matters to the user.>
- **How it works:**
  - <what the user does>
  - <what they see / the interaction>
  - <key UX: optimistic update, keyboard, undo, etc.>
- **Scenarios (GWT):**

```
Scenario: <happy path name>
  Given <observable state>
  When  <user action>
  Then  <observable outcome>

Scenario: <edge case name>
  Given <state>
  When  <action>
  Then  <outcome>
```

### Slice N-B — <Title>

- **User value:** …
- **How it works:**
  - …
- **Scenarios (GWT):**
  - …

---

## Build notes _(implementation — skip when reviewing)_

<!-- Everything agent-facing lives below the divider: events, projections, API, tests, decisions. -->

### N-A
- **Events/commands:** …
- **Projections:** …
- **API:** …
- **Tests:** …
- **Acceptance criteria:** <one line each, `[ ]` checkbox; Scribe marks `[x]` on deploy>
- **Decisions:** …

### N-B
- …

### Observability
- <silent failure modes per slice; instrumentation gaps — from the `observability-brief` skill>

### Deploy-time
- <faster / neutral / +N min, one-off vs recurring — required if the slice touches the deploy path>
