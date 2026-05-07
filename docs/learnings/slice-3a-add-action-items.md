# Learnings: Slice 3-A — Add action items on the note screen

## What was inefficient or went wrong

- **Missing E2E test caught by Hawk, not Pip.** The acceptance criterion explicitly stated an E2E journey test, but Pip didn't write it. Hawk had to flag it as a `Changes requested` finding, adding a round-trip before merge.

- **`GetActions` returning 200 for non-existent notes.** Pip applied the note-existence guard on the write endpoint (`POST /notes/{noteId}/actions`) but forgot it on the read endpoint (`GET /notes/{noteId}/actions`). Hawk caught this on review. A second round-trip was required.

- **Double-deserialize smell caught in refactor, not during initial implementation.** `ActionItemCommandHandler` initially re-deserialised events that had just been created from `newEvents`. This was caught in the refactor pass and fixed with `Zip`, but ideally Pip would have noticed this pattern while writing the implementation.

## Suggested process improvements

- **Pip should use the acceptance criteria as a checklist before opening the PR.** Each criterion should map to either a spec, an integration test, or an E2E test. Any criterion with no corresponding test should be flagged before opening the PR — not left for Hawk to find.

- **Pip should apply symmetry checks on read/write endpoint pairs.** When a write endpoint guards on resource existence (note must exist), the corresponding read endpoint should too. A simple mental model: "does every endpoint I wrote return the same error for a missing parent resource?"

- **The refactor pass caught the double-deserialize smell — the implementation pass should have.** When Pip writes projection update logic that calls `EventDeserializer.Deserialize` on envelopes that were just created from known domain events, it should immediately reach for `Zip` over the `newEvents` list instead.

## Hawk review findings

| Finding | File | How to prevent |
|---|---|---|
| Missing E2E test for persistence acceptance criterion | tests/E2E/ | Pip should map each acceptance criterion to a test before opening the PR |
| GetActions returns 200 for non-existent notes | src/Api/Handlers/ActionItemHandlers.cs:29 | Pip should apply note-existence guard symmetrically across read/write endpoints on the same resource |
| ToEnvelopes duplicated across two command handlers | src/Api/ActionItemCommandHandler.cs:48, NoteCommandHandler.cs:87 | Flag when a third handler appears; extract then |
