# Phase 43 — Meeting agenda (topics to discuss, separate from the note body)

**Goal:** give each note a first-class **agenda** — a short checklist of things to discuss that the owner adds before/during a meeting and ticks off as covered. It lives in the note **header** (expanded, collapsible), costs **no side space**, and is stored **separately** from the free-form markdown note body. This decouples "a topic to discuss" from "a heading in the notes" — the conflation behind the old heading-✓ (BUG-37) — so the body stays free-form and untouched.

## Summary

| Slice | Summary | Status | Depends on |
|-------|---------|--------|------------|
| 43-A | Add an agenda item to a note; it persists and shows in the header (locks the event model on one real call) | Not Started | — |
| 43-B | Tick / untick an item; header shows "X / Y covered" | Not Started | 43-A |
| 43-C | Edit an item's text; remove an item | Not Started | 43-A |
| 43-D | Collapsible header agenda strip (expanded default, collapses to one line + what's left); Stylist polish | Not Started | 43-A, 43-B |
| 43-E | Retire the legacy heading-✓ "mark as discussed" (now redundant) | Not Started | 43-D |

Reorder (drag) is deferred — not needed to ship value; item order is capture order for now. 43-A is the thin vertical that proves the whole pipe and locks the event-model shape; 43-B/C extend the same model; 43-D is UI polish; 43-E removes the superseded mechanism.

**Validated by prototype:** branch `prototype/topics-explore` — gallery `topics-prototypes/index.html`; final direction **`v7-agenda-in-header.html`** (reached via 9 Round-1 explorations → Checkline refinements → free-form-note + separate-agenda rounds). Real implementation starts from this doc, not the prototype code.

**Locked decisions (from the prototype iteration):**
1. Agenda is **separate data**, not encoded in the note markdown.
2. Lives in the note **header area** (with the title), **expanded** by default, collapsible to one line.
3. Items are **2-state**: open or ticked (no intermediate "topic" state).
4. Operations: add, tick/untick, edit text, remove. **Reorder later.**
5. **No side space** — tags/actions keep theirs; the note body stays full-width and free-form.

## Event model

Decide in 43-A (run `event-modelling`): model agenda items as **events on the Note stream** (per-note, lightweight, like tags; handled by `NoteCommandHandler`) vs. a dedicated aggregate. Lean note-stream. New events — purely additive, never edit a shipped shape:

| Event | Payload | When |
|-------|---------|------|
| `AgendaItemAdded` | `itemId`, `text`, `position` | add an item |
| `AgendaItemDiscussedSet` | `itemId`, `discussed` (bool) | tick / untick |
| `AgendaItemTextEdited` | `itemId`, `text` | edit text |
| `AgendaItemRemoved` | `itemId` | remove |

- **Projection** `AgendaView` keyed by `noteId` → ordered `[{itemId, text, discussed, position}]`; rebuildable from the stream; updated **inline** in the command handler (no dispatcher); wired into `ProjectionRebuildHandler`.
- Map every field in **both** `InMemoryAgendaStore` and `DynamoDbAgendaStore`, plus an `EventStore.Integration` round-trip test (set → Upsert → Get → assert) — the in-memory double structurally hides an unmapped DynamoDB attribute (guardrail).
- Surface on `GET /notes/{id}` (compose an `agenda` field) or a dedicated `GET /notes/{id}/agenda`.
- **Optimistic UI** for every mutation (add/tick/edit/remove) — mandatory acceptance criterion on every slice with frontend changes.

## Slices

### 43-A — Add an agenda item
**Value:** before (or during) a meeting, jot a thing you need to discuss onto the note and have it stick — your first real agenda item, captured in seconds without touching the notes.
```
Given a note
When  the owner adds an agenda item "Budget (Q3)"
Then  AgendaItemAdded is appended and the item appears in the note header agenda
And   it persists across reload (AgendaView)

Given a note with no agenda
Then  the header shows an empty, expanded agenda with an "add item" affordance
```
Acceptance:
- [ ] BDD spec first; event-model decision (note-stream vs aggregate) recorded in the spec.
- [ ] `AgendaItemAdded` + `AgendaView` projection; rebuild path wired in `ProjectionRebuildHandler`.
- [ ] Field mapped in InMemory **and** DynamoDb stores + an `EventStore.Integration` round-trip test.
- [ ] Optimistic add in the header UI.
- [ ] New projection **backfilled** post-deploy (`POST /admin/projections/rebuild`) and verified non-empty in prod (Scribe step).

### 43-B — Tick / untick an item
**Value:** tick a topic off the moment it's covered and see at a glance how much of the agenda is left ("2 / 5") — so nothing gets missed and you know when you're done.
```
Given an agenda item "Budget (Q3)"
When  the owner ticks it
Then  AgendaItemDiscussedSet(discussed=true) is appended; the item shows ticked
And   the header shows "1 / N covered"
When  the owner unticks it
Then  it returns to open and the count decrements
```
Acceptance:
- [ ] 2-state only (open/ticked); optimistic; persists across reload.
- [ ] Coverage count + "what's left" derive from `AgendaView`.

### 43-C — Edit text + remove
**Value:** fix a typo in an agenda item, reword it, or drop one that's no longer relevant — keep the list tidy and accurate.
```
When  the owner edits an item's text   → AgendaItemTextEdited; new text persists
When  the owner removes an item         → AgendaItemRemoved; it disappears and stays gone on reload
```
Acceptance:
- [ ] Inline edit + remove, both optimistic.
- [ ] Removing a ticked item updates the coverage count.

### 43-D — Collapsible header agenda strip + polish
**Value:** the agenda stays glanceable at the top of the note while you write, and folds away to a single "Agenda · 2/5" line when you want the note to be the focus — never stealing note space or a side column.
```
Given a note's header agenda
Then  it is expanded by default
When  the owner collapses it
Then  it shows one line: "Agenda · X / Y" + the remaining items
And   the note body stays full-width (no side space) in both states
```
Acceptance:
- [ ] Header component; expanded default; collapse-to-one-line showing the remaining items.
- [ ] Stylist pass (`ui-ux-pro-max`); matches the note header.
- [ ] Verified to add **no** side-panel column; tags/actions layout unaffected.

### 43-E — Retire the legacy heading-✓ "mark as discussed"
**Value:** one clear, predictable way to track topics — the old per-heading ✓ that confused "is this a topic?" with "is this a heading?" (and broke in BUG-37) is gone, so the feature is no longer ambiguous.
```
Given the agenda now owns "topics to discuss"
Then  the floating ✓ on headings is removed (markHeadingDiscussed + the floating control)
And   existing notes whose headings contain ~~strikethrough~~ keep that text as ordinary markdown (no migration)
```
Acceptance:
- [ ] Remove the heading-✓ control + `web/src/lib/headingDiscussed.ts` + its unit tests + the `DiscussedTickJourney` E2E.
- [ ] Confirm no regression to the free-form editor (headings/bold/lists still work).
- [ ] Learnings note: the heading-as-topic experiment (Phase 7-B → BUG-37) is superseded by the separate agenda.

## Observability (Scout brief)

Run `observability-brief` to finalise. Silent failure modes to instrument:
- An add/tick that **200s but doesn't persist** — projection not updated, or a new `AgendaView` field unmapped in `DynamoDbAgendaStore` (the in-memory double hides it). → round-trip test + a structured log on each agenda mutation (`noteId`, `itemId`, op).
- **Agenda missing on reload** — projection lag or not composed into the note read. → inline projection update; compose/gate at read.
- **Optimistic update masks a failed write** — reconcile on error; surface a toast.
- New projection ships **empty** — backfill after the 43-A deploy and verify item count in prod.

## Out of scope / later
- Reorder (drag) agenda items.
- Seeding the agenda from the calendar event or a template.
- Carrying unfinished agenda items to the next occurrence's note.
