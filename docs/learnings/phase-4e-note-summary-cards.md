---
name: Phase 4-E — Note summary cards
type: project
date: 2026-05-08
---

# Slice 4-E — Note summary cards on home screen

## What we built

New `NoteCardList` projection folding 9 event types into a DynamoDB table. `GET /notes/cards` endpoint returns rich card data. Home screen now renders a card grid with title, date, content snippet, open actions, and a clickable card + "Edit Note" button.

## Key learnings

### 1. Rebase before opening a PR

The 4-E branch was created before the Scribe commit for 4-C/4-D landed on main. The branch needed `git rebase main` before the PR reflected the full docs state. Rule: always rebase the feature branch onto main before running Stylist or opening a PR.

### 2. LastModifiedAt is systematic, not per-handler

Hawk caught that all four action item event handlers in `NoteCardListProjection.Handle` set `ActionItems` but omitted `LastModifiedAt = envelope.OccurredAt`. The same omission was in the command handler helper. BDD specs and integration tests don't assert `LastModifiedAt` on action events, so it slipped past automated checks. Add a standing check to the Refactor pass: *every `with { ... }` expression on a projection record must include `LastModifiedAt` if the record has that field and the event is a mutation*.

### 3. Two switch statements, one rule

The Refactor pass added `default: break` to `NoteCardListProjection.Handle`. Hawk found the same rule violated in `ApplyNoteEventsToCard` in `NoteCommandHandler`. When a file has multiple `switch (EventDeserializer.Deserialize(...))` expressions, grep for all of them during the Refactor pass.

### 4. CancellationToken threading in Minimal APIs

ASP.NET Minimal APIs bind `CancellationToken` by name. Missing the parameter silently means no cancellation — the framework doesn't warn. `GetNoteCards` called `store.QueryAllAsync()` without a token, dropping the HTTP disconnect signal on what is the most expensive store operation (full scan). Established pattern: all async handlers take `CancellationToken ct` and pass it through.

### 5. Read-modify-write for cross-aggregate projections

The `NoteCardList` projection is updated from two command handlers (Note and ActionItem). Rather than re-folding the full event stream on each write, both handlers do a read-modify-write: load the stored card, apply only the relevant delta, upsert. This keeps command handlers fast but requires them to stay in sync with the projection's fold logic — tested via integration tests, not BDD specs.
