# Phase 29-A — A versioned prompt can be eval-neutral *by construction*

**Slice:** 29-A — inline `/ai` instructions executed during analysis (PR #290, deploy `29922b5`).

## The learning

A new prompt version that **delegates to the prior version for the entire population the eval measures** cannot regress that population — so a real eval run is uninformative and the gate is satisfied by construction, not by spending Bedrock calls.

`analysis@v7` adds `/ai` instruction execution. `BuildV7` does literally this:

```csharp
if (instructions.Count == 0) return BuildV6(request);   // byte-identical, not "equivalent"
```

The eval matrix contains **no `/ai` fixtures**. So every fixture feeds v7 the exact v6 prompt → exact v6 output → zero delta. A v7-vs-v6 run would compare a prompt to itself.

**Why this matters:** the project's discipline is "prompt changes are eval-driven; evidence is an eval run" (CLAUDE.md). That rule assumes the change *can* alter the measured output. When the change is gated behind an input the matrix never exercises, the honest move is to **record the by-construction argument** (here, `MPI-7`) in lieu of a run — and prove the *new* path (which the eval cannot see) with the tools that can: Domain.Specs + Api.Integration (deterministic fake) + vitest.

**Reusable shape:** when versioning a prompt to add a capability behind a trigger, make the no-trigger branch delegate to the prior version verbatim. This (a) makes back-compat the strongest possible claim (byte-identical, not asserted), (b) collapses the regression risk to zero for the existing population, and (c) isolates the behavioural change to the new path. It is the prompt-layer analogue of the strangle pattern.

## Secondary learning — full-snapshot projection fields must clear, and the aggregate is the wrong place to decide "when"

`InstructionResponsesRecorded` is a full snapshot, latest-wins (like `AnalysisSummaryRecorded`). First cut had the aggregate drop an empty list (`Count == 0 → []`), so a re-run that produced no responses **never cleared** stale cards — they persisted forever (Hawk caught it).

Fix, mirroring `RecordAnalysisSummary`:
- **Aggregate always emits when handled** — an empty list is a valid "cleared" snapshot. The aggregate has no business deciding whether clearing is needed; it just records the snapshot it's given.
- **The handler decides *whether to issue* the command**: `instructionResponses.Count > 0 || hadResponses` (prior state read from the projection). A note that never had responses still writes no event — the common case stays clean.

**Rule:** for a latest-wins projection field, the empty value must be representable as an event (or the field can never return to empty). Put the "is there anything to record or clear?" decision in the handler (which has prior-state context), not the aggregate (which should stay a pure snapshot emitter).

## Process notes
- **No Browser.E2E for analysis flows** — the suite deliberately has none, because analysis hits real non-deterministic Bedrock; an E2E asserting on generated text is flaky. Coverage for `/ai` is Api.Integration against the deterministic fake. Don't add an analysis journey to satisfy a phase-doc acceptance line written before that constraint was rediscovered — refine the acceptance instead.
- **The one uncovered path was the DynamoDB store mapping** (`DynamoDbNoteDetailStore` manual attribute (de)serialization), because EventStore.Integration needs Docker (down locally) and had no pre-existing NoteDetail-store round-trip test. CI's `eventstore` job (Docker) is the backstop; the mapping mirrors the existing `DiscussionPoints`/`Decisions` pattern exactly. Flagged in the PR rather than hidden.
