# RYW-3c — the analysis flow was already migrated; the slice that found nothing to do

**Slice:** 27-RYW-3c · **PR** #271 · **Deploy** #559 green

RYW-3c was specced (back at RYW-1) as "migrate the AI-analysis flow to async + RYW and close the transient feedback double-count." Scoping it found **there was nothing to migrate** — and the double-count had already closed two slices earlier.

## The finding

- Analysis produces no events of its own on a dedicated stream. `TranscriptionHandlers.AnalyseNote` routes everything through existing aggregates: `RecordAnalysisSummary`/`RecordTagSuggestions`/`RecordActionItemSuggestions` → the **`note#`** stream; `AddActionItem` → **`action#`** streams.
- Both `note#` (RYW-2) and `action#` (RYW-3a) were already migrated — their handlers append-only, their inline projection writes removed.
- So the feedback `SuggestedCount` `ADD` (non-idempotent) had **one** writer (the projector) since RYW-2. The double-count — inline write *and* projector both running the `ADD` — closed when `note#` migrated, **not** in a dedicated analyse migration.
- `grep` for inline `projectionUpdater.` calls across `src/Api/CommandHandlers` + `Handlers` → **zero**. Every command handler is append-only.

So RYW-3c shipped as a **verify-slice**: a regression-guard test (`Analyse_SuggestingOneAction_IncrementsSuggestedCountExactlyOnce`) that fails `+2` if any inline feedback write is ever re-introduced, plus retiring the now-false "analysis still inline" comment in `SyncProjectingEventStore`.

## Lessons

1. **A planning doc's slice list is a hypothesis about the work, not the work.** RYW-3c was carved out at RYW-1 time on the assumption analysis was a distinct still-inline flow. Once you trace where its events actually land, the slice dissolves into prior slices. **Scope from the code, not the plan** — and when a slice turns out done, say so and ship the guard, don't manufacture a migration to match the doc.

2. **A cross-cutting invariant ("the projector is the sole writer") is closed by whichever slice removes the last contributing inline write — which may not be the slice named after it.** The double-count was a property of the `note#` inline write; it died with RYW-2. Attributing the close to "the analysis slice" would have been a false history. The guard test + corrected comments pin the *real* close point.

3. **When a migration completes earlier than planned, the value left is a pin, not a change.** The exactly-once test is load-bearing (Hawk's mutation test confirmed it fails on a re-introduced inline write). It converts a transient, already-fixed bug into a permanent invariant.

## Consequence for RYW-4

Every projected stream type is migrated and every handler is append-only as of RYW-3b. RYW-4's "last inline write removed → projector is the sole writer" condition is **already true** — RYW-4 is cleanup + documentation (architecture.md / ADR 0009), not a behavioural cutover. See [[phase-27ryw3b-folder-workspace-read-your-writes]].
