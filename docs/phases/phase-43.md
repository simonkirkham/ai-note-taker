# Phase 43 — Meeting agenda (topics to discuss, separate from the note body) _(Done)_

**Goal:** give each note a short checklist of things you need to discuss, sitting in the note header, that you tick off as you cover them.

## Summary

| Slice | What the user gets | Status | Depends on |
|-------|--------------------|--------|------------|
| 43-A | Jot a topic you need to discuss onto a note and have it stick | Done _(#368)_ | — |
| 43-B | Tick a topic off as it's covered, and see how much is left ("2 / 5") | Done _(#373)_ | 43-A |
| 43-C | Fix the wording of a topic, or drop one that's no longer relevant | Done _(#374)_ | 43-A |
| 43-D | Fold the agenda away to a single line when you want the note to be the focus | Done _(#375)_ | 43-A, 43-B |
| 43-E | One clear way to track topics — the old, ambiguous per-heading ✓ is gone | Done _(#376)_ | 43-D |

43-A is the thin vertical that proves the whole pipe; 43-B/C extend it; 43-D is polish; 43-E removes the superseded mechanism. **Reorder (drag) is deferred** — order is capture order for now.

**Validated by prototype:** branch `prototype/topics-explore`, gallery `topics-prototypes/index.html`; final direction `v7-agenda-in-header.html`, reached via 9 Round-1 explorations → Checkline refinements → free-form-note + separate-agenda rounds.

## Slices

### 43-A — Jot down a topic to discuss

**User value:** before or during a meeting, capture a thing you need to raise onto the note in seconds — without interrupting your notes to do it.

**How it works:**
- The agenda sits in the note **header**, next to the title, expanded and ready.
- A note with no agenda yet still shows the strip, empty, with an obvious way to add the first item.
- A new item appears the instant you add it, before the server confirms.
- It is still there when you come back to the note.
- The note body is untouched — the agenda is its own thing, not text in your notes.

**Scenarios (GWT):**
```
Scenario: Add the first agenda item
  Given a note
  When  I add an agenda item "Budget (Q3)"
  Then  it appears in the note header straight away
  And   it is still there when I reload the note

Scenario: A note with no agenda yet
  Given a note I have not added any topics to
  Then  the header shows an empty, expanded agenda with a way to add one
```

### 43-B — Tick topics off as you cover them

**User value:** you can see at a glance how much of the agenda is left, so nothing gets missed and you know when you're done.

**How it works:**
- Tick an item the moment it's covered; untick it if you tick the wrong one.
- The header shows a running "X / Y covered" count.
- Items are simply open or ticked — there's no in-between state to reason about.
- Ticking is optimistic and survives a reload.

**Scenarios (GWT):**
```
Scenario: Tick a topic off
  Given an agenda item "Budget (Q3)"
  When  I tick it
  Then  it shows as ticked
  And   the header count goes up by one

Scenario: Untick a topic
  Given a ticked agenda item
  When  I untick it
  Then  it is open again and the count goes down by one
```

### 43-C — Fix or drop a topic

**User value:** keep the list accurate — correct a typo, reword a topic, or remove one that stopped being relevant.

**How it works:**
- Click a topic's text to edit it in place; **Enter** or clicking away saves, **Esc** cancels.
- Leaving it blank, or unchanged, saves nothing.
- A **×** removes an item; it stays gone after a reload.
- Removing a ticked item updates the "X / Y" count.

**Scenarios (GWT):**
```
Scenario: Reword a topic
  Given an agenda item
  When  I edit its text and press Enter
  Then  the new text is shown and survives a reload

Scenario: Cancel an edit
  Given I am editing an agenda item's text
  When  I press Esc
  Then  the original text is kept

Scenario: Remove a topic
  Given an agenda item
  When  I remove it
  Then  it disappears and is still gone after a reload

Scenario: Removing a ticked topic updates the count
  Given a ticked agenda item on a note showing "2 / 5 covered"
  When  I remove it
  Then  the count reflects the shorter list
```

### 43-D — Fold the agenda away

**User value:** the agenda stays glanceable while you write, and folds to a single line when you want the note to have your full attention — it never steals note width or a side column.

**How it works:**
- Expanded by default; a caret collapses it to one line — "Agenda · 2 / 5" plus a peek at what's left, or "all covered ✓".
- The toggle only appears once there is something to collapse.
- The note body stays full-width in **both** states.

**Scenarios (GWT):**
```
Scenario: The agenda is open by default
  Given a note with agenda items
  Then  the agenda is expanded

Scenario: Collapse the agenda
  Given an expanded agenda
  When  I collapse it
  Then  it shows one line with the coverage count and what is left
  And   the note body is still full-width

Scenario: Nothing to collapse
  Given a note with no agenda items
  Then  no collapse toggle is shown
```

### 43-E — One way to track topics

**User value:** the old per-heading ✓ confused "is this a topic?" with "is this a heading?" — and had stopped working ([BUG-37](phase-bugs.md#bug-37)). Removing it leaves one clear, predictable way to track what you've discussed.

**How it works:**
- The floating ✓ on headings is gone, along with its keyboard-shortcut entry.
- Notes are unaffected — the editor's headings, bold and lists all behave exactly as before.
- Old notes whose headings were struck through keep that text as ordinary formatting; nothing is migrated or lost.

**Scenarios (GWT):**
```
Scenario: The heading tick is gone
  Given the agenda now owns "topics to discuss"
  Then  no floating ✓ appears on a heading

Scenario: Existing struck-through headings are untouched
  Given a note whose heading was struck through under the old mechanism
  When  I open it
  Then  the heading still shows as struck through, as ordinary formatting
```

---

## Build notes _(implementation — skip when reviewing)_

### Locked decisions (from the prototype iteration)

1. Agenda is **separate data**, not encoded in the note markdown.
2. Lives in the note **header area** (with the title), **expanded** by default, collapsible to one line.
3. Items are **2-state**: open or ticked (no intermediate "topic" state).
4. Operations: add, tick/untick, edit text, remove. **Reorder later.**
5. **No side space** — tags/actions keep theirs; the note body stays full-width and free-form.

### Event model

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

### Slice 43-A — Add an agenda item

- [x] BDD spec first; event-model decision (note-stream events, composed onto `NoteDetailView`) recorded in the spec.
- [x] `AgendaItemAdded` + read model composed onto `NoteDetailView` (folded in `NoteDetailProjection`; rebuilds via the existing NoteDetail path — no dedicated `AgendaView` store/table, by the decision above).
- [x] `Agenda` field mapped in InMemory **and** DynamoDb note-detail stores + an `EventStore.Integration` round-trip test.
- [x] Optimistic add in the header UI (`AgendaSection` + `useAddAgendaItem`).
- [x] No new projection table → **no backfill needed** (existing notes correctly have empty agendas; no historical `AgendaItemAdded` events). Deploy-time neutral.

_(Done — PR #368, deploy #671 / run 28468842329, live. See [phase-43a-agenda-add](../learnings/phase-43a-agenda-add.md).)_

### Slice 43-B — Tick / untick an item

- [x] 2-state only (open/ticked); optimistic; persists across reload. `AgendaItemDiscussedSet` is idempotent (setting the current state is a no-op); unknown item → 404.
- [x] Coverage count derives from the composed `NoteDetailView.Agenda` (done / total), shown as a "X / Y" pill in the header (aria-label "X of Y agenda items covered").

_(Done — PR #373, deploy run 28474505369 (carried with #372 after an E2E cold-start flake re-run), live.)_

### Slice 43-C — Edit text + remove

- [x] Inline edit (click text → input; Enter/blur commits, Esc cancels, blank/unchanged sends nothing) + remove (×), both optimistic. Edit blank → 400; unknown item → 404; remove 404 accepted as no-op.
- [x] Removing a ticked item updates the (derived) coverage count.
- [x] Position now derives from a **monotonic add-counter** so an add after a remove never reuses a surviving item's position (the 43-B forward-flag).

_(Done — PR #374, deploy run 28477668516, live. Esc-cancel guard mirrors `ActionsSection`'s `editingRef` — a real-browser blur-on-unmount bug jsdom can't catch.)_

### Slice 43-D — Collapsible header agenda strip + polish

- [x] Expanded by default; a caret/label toggle collapses to one line (coverage pill + remaining-items peek, or "all covered ✓"); toggle only shows when there are items. `aria-expanded`/`aria-controls`.
- [x] Stylist pass (`ui-ux-pro-max` vs `design-system/ai-note-taker/MASTER.md`); focus-visible rings match CommandBar; caret reduced-motion handled globally; token-based.
- [x] Full-width in both states; **no** side-panel column; tags/actions (CommandBar) layout unaffected; new-note tab order unchanged.

_(Done — PR #375, deploy run 28479345632, live. Frontend-only; no events/backend/CDK.)_

### Slice 43-E — Retire the legacy heading-✓ "mark as discussed"

- [x] Removed the heading-✓ control (floating ✓ + `buttonY`/`updateButton`/`containerRef` wiring + `.discussedButton` CSS) + `web/src/lib/headingDiscussed.ts` + its unit tests + the `DiscussedTickJourney` E2E. ShortcutsPanel ✓ row removed; headings relabelled plain.
- [x] No regression to the free-form editor (headings/bold/lists come from StarterKit, untouched). Existing `~~strikethrough~~` headings stay as ordinary markdown (no migration).
- [x] Learnings: [phase-43e-retire-heading-tick](../learnings/phase-43e-retire-heading-tick.md) — heading-as-topic (Phase 7-B → BUG-37/37b) superseded by the separate agenda.

_(Done — PR #376, deploy run 28480430234, live. **Phase 43 complete.**)_

### Observability

Silent failure modes considered at Scout time:

- An add/tick that **200s but doesn't persist** — projection not updated, or a new field unmapped in `DynamoDbNoteDetailStore` (the in-memory double hides it). → round-trip test + a structured log on each agenda mutation (`noteId`, `itemId`, op).
- **Agenda missing on reload** — projector lag, or not composed into the note read. → composed onto `NoteDetailView` and gated at read by the consistency token.
- **Optimistic update masks a failed write** — reconcile on error; surface a toast.
- ~~New projection ships **empty** — backfill after the 43-A deploy~~ — **N/A** (43-A composed onto `NoteDetailView`, no new table; nothing to backfill).

### Deploy-time impact

**Neutral.** No new CDK resource, no new table, no projection backfill — additive events on an existing stream folded into an existing view.

### Out of scope / later

- Reorder (drag) agenda items.
- Seeding the agenda from the calendar event or a template.
- Carrying unfinished agenda items to the next occurrence's note.
