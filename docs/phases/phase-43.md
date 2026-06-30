# Phase 43 — Meeting agenda (topics to discuss, separate from the note body)

**Goal:** give each note a first-class **agenda** — a short checklist of things to discuss that the owner adds before/during a meeting and ticks off as covered. It lives in the note **header** (expanded, collapsible), costs **no side space**, and is stored **separately** from the free-form markdown note body. This decouples "a topic to discuss" from "a heading in the notes" — the conflation behind the old heading-✓ (BUG-37) — so the body stays free-form and untouched.

## Summary

| Slice | Summary | Status | Depends on |
|-------|---------|--------|------------|
| 43-A | Add an agenda item to a note; it persists and shows in the header (locks the event model on one real call) | Done | — |
| 43-B | Tick / untick an item; header shows "X / Y covered" | Done | 43-A |
| 43-C | Edit an item's text; remove an item | Done | 43-A |
| 43-D | Collapsible header agenda strip (expanded default, collapses to one line + what's left); Stylist polish | Done | 43-A, 43-B |
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

**Decided in 43-A:** agenda items are **events on the Note stream** (per-note, lightweight, like tags; handled by `NoteCommandHandler`), and the read model is **composed onto `NoteDetailView`** (a new `Agenda` field, folded in `NoteDetailProjection`) — **not** a dedicated aggregate or a dedicated `AgendaView` store/table. Rationale: agenda is note-scoped, always read with the note, never queried across notes, so a dedicated table + backfill would be over-engineering; composing also sidesteps the async-projection authz/lag pitfalls (BUG-30) and is deploy-time neutral (no new CDK resource, no backfill). New events — purely additive, never edit a shipped shape:

| Event | Payload | When | Slice |
|-------|---------|------|-------|
| `AgendaItemAdded` | `itemId`, `text`, `position` | add an item | 43-A ✅ |
| `AgendaItemDiscussedSet` | `itemId`, `discussed` (bool) | tick / untick | 43-B ✅ |
| `AgendaItemTextEdited` | `itemId`, `text` | edit text | 43-C ✅ |
| `AgendaItemRemoved` | `itemId` | remove | 43-C ✅ |

- **Read model** = `NoteDetailView.Agenda` (ordered `[{itemId, text, discussed, position}]`), folded in `NoteDetailProjection`; rebuilds via the existing NoteDetail rebuild path (no separate projection to wire). `AgendaItemView` carries `discussed`/`position` from 43-A so 43-B/C add no view-shape change.
- The new `Agenda` field is mapped in **both** `InMemoryNoteDetailStore` (by reference) **and** `DynamoDbNoteDetailStore` (`UpsertAsync` write + `MapItemToNoteDetailView`/`ReadAgenda` read), plus an `EventStore.Integration` round-trip test — the in-memory double structurally hides an unmapped DynamoDB attribute (guardrail).
- Surfaced on `GET /notes/{id}` (composed `agenda` array). Add route: `POST /notes/{id}/agenda-items`.
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
- [x] BDD spec first; event-model decision (note-stream events, composed onto `NoteDetailView`) recorded in the spec.
- [x] `AgendaItemAdded` + read model composed onto `NoteDetailView` (folded in `NoteDetailProjection`; rebuilds via the existing NoteDetail path — no dedicated `AgendaView` store/table, by the decision above).
- [x] `Agenda` field mapped in InMemory **and** DynamoDb note-detail stores + an `EventStore.Integration` round-trip test.
- [x] Optimistic add in the header UI (`AgendaSection` + `useAddAgendaItem`).
- [x] No new projection table → **no backfill needed** (existing notes correctly have empty agendas; no historical `AgendaItemAdded` events). Deploy-time neutral.

_(Done — PR #368, deploy #671 / run 28468842329, live. See [phase-43a-agenda-add](../learnings/phase-43a-agenda-add.md).)_

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
- [x] 2-state only (open/ticked); optimistic; persists across reload. `AgendaItemDiscussedSet` is idempotent (setting the current state is a no-op); unknown item → 404.
- [x] Coverage count derives from the composed `NoteDetailView.Agenda` (done / total), shown as a "X / Y" pill in the header (aria-label "X of Y agenda items covered").

_(Done — PR #373, deploy run 28474505369 (carried with #372 after an E2E cold-start flake re-run), live.)_

### 43-C — Edit text + remove
**Value:** fix a typo in an agenda item, reword it, or drop one that's no longer relevant — keep the list tidy and accurate.
```
When  the owner edits an item's text   → AgendaItemTextEdited; new text persists
When  the owner removes an item         → AgendaItemRemoved; it disappears and stays gone on reload
```
Acceptance:
- [x] Inline edit (click text → input; Enter/blur commits, Esc cancels, blank/unchanged sends nothing) + remove (×), both optimistic. Edit blank → 400; unknown item → 404; remove 404 accepted as no-op.
- [x] Removing a ticked item updates the (derived) coverage count.
- [x] Position now derives from a **monotonic add-counter** so an add after a remove never reuses a surviving item's position (the 43-B forward-flag).

_(Done — PR #374, deploy run 28477668516, live. Esc-cancel guard mirrors `ActionsSection`'s `editingRef` — a real-browser blur-on-unmount bug jsdom can't catch.)_

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
- [x] Expanded by default; a caret/label toggle collapses to one line (coverage pill + remaining-items peek, or "all covered ✓"); toggle only shows when there are items. `aria-expanded`/`aria-controls`.
- [x] Stylist pass (`ui-ux-pro-max` vs `design-system/ai-note-taker/MASTER.md`); focus-visible rings match CommandBar; caret reduced-motion handled globally; token-based.
- [x] Full-width in both states; **no** side-panel column; tags/actions (CommandBar) layout unaffected; new-note tab order unchanged.

_(Done — PR #375, deploy run 28479345632, live. Frontend-only; no events/backend/CDK.)_

### 43-E — Retire the legacy heading-✓ "mark as discussed"
**Value:** one clear, predictable way to track topics — the old per-heading ✓ that confused "is this a topic?" with "is this a heading?" (and broke in BUG-37) is gone, so the feature is no longer ambiguous.
```
Given the agenda now owns "topics to discuss"
Then  the floating ✓ on headings is removed (markHeadingDiscussed + the floating control)
And   existing notes whose headings contain ~~strikethrough~~ keep that text as ordinary markdown (no migration)
```
Acceptance:
- [x] Removed the heading-✓ control (floating ✓ + `buttonY`/`updateButton`/`containerRef` wiring + `.discussedButton` CSS) + `web/src/lib/headingDiscussed.ts` + its unit tests + the `DiscussedTickJourney` E2E. ShortcutsPanel ✓ row removed; headings relabelled plain.
- [x] No regression to the free-form editor (headings/bold/lists come from StarterKit, untouched). Existing `~~strikethrough~~` headings stay as ordinary markdown (no migration).
- [x] Learnings: [phase-43e-retire-heading-tick](../learnings/phase-43e-retire-heading-tick.md) — heading-as-topic (Phase 7-B → BUG-37/37b) superseded by the separate agenda.

_(Done — PR #376, deploy run 28480430234, live. **Phase 43 complete.**)_

## Observability (Scout brief)

Run `observability-brief` to finalise. Silent failure modes to instrument:
- An add/tick that **200s but doesn't persist** — projection not updated, or a new `AgendaView` field unmapped in `DynamoDbAgendaStore` (the in-memory double hides it). → round-trip test + a structured log on each agenda mutation (`noteId`, `itemId`, op).
- **Agenda missing on reload** — projection lag or not composed into the note read. → inline projection update; compose/gate at read.
- **Optimistic update masks a failed write** — reconcile on error; surface a toast.
- ~~New projection ships **empty** — backfill after the 43-A deploy~~ — **N/A** (43-A composed onto `NoteDetailView`, no new table; nothing to backfill).

## Out of scope / later
- Reorder (drag) agenda items.
- Seeding the agenda from the calendar event or a template.
- Carrying unfinished agenda items to the next occurrence's note.
