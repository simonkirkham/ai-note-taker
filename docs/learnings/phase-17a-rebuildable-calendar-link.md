# Phase 17-A — Surfacing a note's linked meeting: a projection that under-captured

**Slice:** 17-A (read-side of Phase 17). PR #176.

## What happened

`GetNote` needed to show the linked meeting's title + time. The data was already in the event stream — `NoteLinkedToCalendarEvent` has carried `CalendarEventTitle` and `EndTime` since Phase 9 — but the `CalendarLinkView` projection only stored `CalendarEventId`, `NoteId`, `RecurringSeriesId`, `StartTime`. The projection **under-captured** fields the event already had.

## The two non-obvious points

1. **Widen-and-rebuild beats event versioning when the event is already right.** No event change was needed — the fix was a projection-schema change (add two fields) plus a rebuild. Because projections are rebuildable from history, the rebuild backfills `title`/`endTime` onto every existing meeting-created note with zero event migration. This is the clean half of "events immutable, projections rebuildable": when the gap is in the read model, you never touch history.

2. **`CalendarLinkIndex` was the one projection that couldn't be rebuilt.** It was wired inline in `NoteCommandHandler` but **never added to `ProjectionRebuildHandler`** — so before 17-A, `POST /admin/projections/rebuild` silently skipped it (and the backfill above would have been impossible). 17-A added `CalendarLinkIndexProjection` + `DeleteAllAsync` and wired the rebuild path. Lesson reinforced (already in CLAUDE.md): a projection is only "rebuildable" if it is in **both** the inline write **and** `ProjectionRebuildHandler` — wiring only the inline side leaves a silent gap that no test catches until you need a rebuild.

## Backfill is a deploy step, not automatic

The rebuild runs via the admin endpoint, not on deploy. Existing linked notes show the badge only after `POST /admin/projections/rebuild` is run once post-deploy. New links populate the fields immediately via the inline write.

## Guardrail check

Adding a field to a projection record is a positional-record change — every `new CalendarLinkView(...)` site must update (here: the inline write + `MapItem`; the in-memory test store doesn't construct it). `MapItem` reads the new attributes defensively (`TryGetValue`, `EndTime` falls back to `StartTime`) so pre-rebuild rows don't throw before the backfill runs.
