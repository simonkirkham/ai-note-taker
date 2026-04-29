# Learnings: Phase 1-A — Note aggregate (CreateNote + RenameNote)

## What was inefficient or went wrong

- **Interface location was not resolved before Breaker wrote specs.** `IDomainEvent`, `ICommand`, and `IAggregate` were defined in `Specs.Harness`, which meant Domain could not implement them without a circular reference. Breaker initially wrote the domain types with `using Specs.Harness` — backwards — and the fix required updating `BddHarness.cs` and `SpecHarnessSpecs.cs` mid-spec-writing, creating noise in the commit history. This structural question (where do aggregate contracts live?) should have been resolved by Scout before Breaker began.

- **`NoteId.New()` was added speculatively.** It was unused by any spec and violated the "pass IDs in" guardrail from CLAUDE.md. Hawk caught it; Pip removed it. This is a one-commit fix but represents a class of scope creep (adding helpers that "seem useful") that the workflow should catch earlier.

- **`event-model.md` and `event-schemas.md` were out of sync.** The event model still carried timestamps in its event descriptions, contradicting the resolved decision in `event-schemas.md`. Hawk caught this too. Scout should have aligned the two documents before producing the phase breakdown.

## Suggested process improvements

- **Scout should explicitly resolve aggregate contract placement before the phase breakdown.** The question of where `IDomainEvent`/`ICommand`/`IAggregate` live is an architectural decision, not an implementation detail. It should appear in the phase breakdown file as a resolved decision, not surface as a mid-Breaker surprise.

- **Scout should diff `event-model.md` against `event-schemas.md` at the start of each phase.** Any discrepancy between the two documents should be resolved and committed before Breaker begins. The two documents must stay in sync — if they diverge, Breaker will follow the wrong one.

- **Pip should check for unused helpers before opening a PR.** A simple grep for public static members in Domain that are not referenced anywhere in the solution would have caught `NoteId.New()` before Hawk saw it.

## Hawk review findings

| Finding | File | How to prevent |
|---|---|---|
| `NoteId.New()` places ID generation (a side-effectful `Guid.NewGuid()` call) inside the Domain layer. CLAUDE.md says "pass time and IDs in"; IDs should be generated at the API/application layer. The method is unused by any aggregate in this slice, but sets a precedent. | `src/Domain/Notes/NoteId.cs:5` | Breaker should flag any static factory that produces randomness or timestamps inside `src/Domain/`. Pip should place `New()`-style helpers in application-layer services, not in value-type definitions. |
| `event-model.md` still describes `NoteCreated { NoteId, CreatedAt }` and `NoteRenamed { NoteId, RenamedAt, NewTitle }` with timestamps in the payload, contradicting `event-schemas.md` (the authoritative wire-shape document), which correctly omits them. The implementation follows `event-schemas.md` (correct), but the stale model description could cause a future Breaker pass to re-introduce timestamp fields into aggregate event records. | `docs/event-model.md` (events section) | Scout should diff `event-model.md` against `event-schemas.md` at the start of each slice to surface stale descriptions. Scribe should update both documents in the same commit whenever an event is added or changed. |
