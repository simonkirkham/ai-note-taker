# Phase 43 — Meeting agenda (topics to discuss) _(In Progress — 43-A–G done; only 43-H remains)_

**Goal:** give each note a short checklist of things you need to discuss, which you tick off as you cover them — from the note itself or from the header, wherever your hands already are.

## Summary

| Slice | What the user gets | Status | Depends on |
|-------|--------------------|--------|------------|
| 43-A | Jot a topic you need to discuss onto a note and have it stick | Done _(#368)_ | — |
| 43-B | Tick a topic off as it's covered, and see how much is left ("2 / 5") | Done _(#373)_ | 43-A |
| 43-C | Fix the wording of a topic, or drop one that's no longer relevant | Done _(#374)_ | 43-A |
| 43-D | Fold the agenda away to a single line when you want the note to be the focus | Done _(#375)_ | 43-A, 43-B |
| 43-E | One clear way to track topics — the old, ambiguous per-heading ✓ is gone | Done _(#376)_ | 43-D |
| 43-F | Tick a topic off in the notes as you type, and watch the count move | Done _(#428)_ | 43-D |
| 43-G | Add, reword or drop a topic from the header and have the notes follow | Done _(#438)_ | 43-F |
| 43-H1 | Topics on older notes appear in the notes themselves | In Progress _(merged #441, live in prod deploy #742 — **migration not yet run**: needs a Google bearer token)_ | 43-F |
| 43-H2 | One way everywhere — the old parallel record is gone | Not Started | 43-H1 |

43-A is the thin vertical that proves the whole pipe; 43-B/C extend it; 43-D is polish; 43-E removes the superseded mechanism. 43-F–H then move the agenda **into** the note: 43-F reads it from the notes, 43-G makes the header write back, 43-H moves the stragglers over. **Reorder (drag) is deferred** — order is capture order for now.

**Validated by prototype:** 43-A–E on branch `prototype/topics-explore` (gallery `topics-prototypes/index.html`, direction `v7-agenda-in-header.html`). 43-F–H on branch `prototype/43f-agenda-in-body` (`agenda-prototypes/index.html` static gallery, then `web/src/prototype/` — a real Tiptap editor across five candidate designs; **"Task line" chosen 2026-08-07**).

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

### 43-F — Tick a topic where you're typing

**User value:** meeting notes are running prose, so the checklist you jot in the note *is* the agenda — tick a topic off right where you wrote it, without breaking your typing to reach the header.

**How it works:**
- Any checklist line in a note is a topic on its agenda. Nothing to promote, no extra step.
- Ticking the line in the notes moves the header's "X / Y" count straight away.
- A ticked topic reads struck through in both the notes and the header.
- Type a new checklist line mid-meeting and the count grows as you type.
- Topics added the old way still show in the header until 43-H moves them across — nothing disappears in the meantime.

**Scenarios (GWT):**
```
Scenario: A checklist line in the notes is a topic
  Given a note whose notes contain a checklist line "Budget (Q3)"
  Then  the header agenda shows "Budget (Q3)"
  And   the coverage count includes it

Scenario: Tick a topic in the notes
  Given a note with three checklist lines, none of them ticked
  When  I tick "Budget (Q3)" in the notes
  Then  it reads struck through
  And   the header count reads "1 / 3"

Scenario: Type a new topic mid-meeting
  Given a note with two topics, neither ticked
  When  I type a new checklist line "Renewals"
  Then  the header count reads "0 / 3"

Scenario: Untick a topic
  Given a note with a ticked topic and a count of "1 / 3"
  When  I untick it in the notes
  Then  the count reads "0 / 3"

Scenario: Topics added the old way still appear
  Given a note whose topics were added from the header before this change
  Then  they still appear in the header agenda with their ticked state
```

### 43-G — Manage the agenda from the header

**User value:** keep using the header strip when that's where your hands are — add, tick, reword or drop a topic there and the notes follow, without losing your place or anything you've typed.

**How it works:**
- Adding from the header puts the topic at the end of the note's first checklist; if the note has no checklist yet, one is started at the top.
- Your cursor never moves — adding a topic mid-meeting doesn't interrupt the sentence you're writing.
- Ticking, rewording or removing in the header changes the matching line in the notes.
- **Ctrl+Z** undoes any of them, exactly as if you had edited the line yourself.
- Typing you haven't saved yet is preserved — a header change merges into your in-flight edits rather than overwriting them.

**Scenarios (GWT):**
```
Scenario: Add a topic from the header
  Given a note whose notes already contain a checklist
  When  I add "On-call rotation" in the header agenda
  Then  it appears at the end of that checklist in the notes
  And   my cursor has not moved

Scenario: Add a topic to a note with no checklist
  Given a note of running prose with no checklist in it
  When  I add "Budget (Q3)" in the header agenda
  Then  a new checklist holding it is started at the top of the notes

Scenario: Reword a topic from the header
  Given a topic "Budget (Q3)"
  When  I reword it to "Q3 budget review" in the header
  Then  the matching line in the notes reads "Q3 budget review"

Scenario: Undo a removal
  Given I removed a topic using the header
  When  I press Ctrl+Z
  Then  the line is back in the notes, where it was

Scenario: A header change keeps unsaved typing
  Given I have typed into the notes and not saved yet
  When  I tick a topic in the header
  Then  my unsaved typing is still there
  And   the topic is ticked
```

### 43-H — Older notes' topics move into the notes

**User value:** the handful of notes whose topics were added the old way get them written into the note itself, so every note in the app behaves the same way.

**How it works:**
- Each affected note gains a checklist of its topics at the top, with the already-covered ones already ticked.
- Nothing else in those notes changes — no wording, no formatting, no lost text.
- Afterwards every note's agenda comes from the note itself. One way, everywhere.

**Scenarios (GWT):**
```
Scenario: An older note's topics move into the note
  Given a note whose four topics were added the old way, two of them ticked
  When  the change ships
  Then  the note begins with a checklist of those four topics
  And   the two covered ones read as ticked
  And   the header agenda still reads "2 / 4"

Scenario: A note that never had topics is left alone
  Given a note with no topics
  Then  its notes are unchanged

Scenario: The note's own text is preserved
  Given an older note with topics and several paragraphs of notes
  When  the change ships
  Then  every paragraph is still there, unchanged, below the checklist
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

_(Done — PR #376, deploy run 28480430234, live. **43-A–E complete.**)_

### Model change — the agenda becomes a reading of the note body (43-F onward)

**Decided 2026-08-07** from the `prototype/43f-agenda-in-body` interview. This **reverses** 43-A's "agenda is separate data" decision. Recorded here rather than as a new phase because it is the same user capability, re-cut.

What changed and why:

| Decision | 43-A–E (shipped) | 43-F onward | Why |
|---|---|---|---|
| Where a topic lives | its own events on the Note stream | a task-list line in the note body | notes are running prose; the checklist the user already types *is* the agenda |
| What makes a line a topic | n/a | **every** task-list line in the note | no promotion step; zero friction (explicitly chosen over an explicit `/agenda` promote) |
| Canonical surface | the header strip | **the note body** | the header becomes a view over the body |
| Ticked state | `AgendaItemDiscussedSet` | `- [x]` in the markdown | one writer for one fact |
| Event appended on tick | `AgendaItemDiscussedSet` | `ContentEdited` | the tick *is* a body edit |
| Identity token in markdown | n/a | **none** | because the body is canonical and the tick is `- [x]`, there is nothing to link — the line *is* the item |

- **No new events.** `AgendaItem*` stay in the stream and keep being folded until 43-H; nothing is edited or versioned (guardrail: events are immutable).
- `NoteDetailView.Agenda` is **derived in `NoteDetailProjection`** by parsing task-list items out of the folded content, not from agenda events. Same view shape, same round-trip mapping — `AgendaItemView` already carries `text`/`discussed`/`position`, so no `*View` field is added and the `DynamoDbNoteDetailStore` mapping is untouched.
- **Strangler ordering is mandatory** — do not flip and migrate in one step (guardrail: never big-bang a cross-cutting cutover). 43-F derives from content **and** keeps folding legacy agenda events (union, dedup by text); 43-H migrates the 9 notes and only then drops the legacy fold and the write endpoints.
- **The strike renders from the `[x]` state in CSS, never as literal `~~ ~~` in the markdown.** Writing the marks means unticking has to unwrap them, and it tangles with any `~~` the user typed. Same look, clean round-trip.

### Slice 43-F — Topics come from the note body

- [x] BDD spec first. Fold task-list items out of the content in `NoteDetailProjection` into `NoteDetailView.Agenda`; **union with** the legacy `AgendaItem*` fold (dedup by trimmed + unescaped text; **the body wins** on a matched pair) so no shipped note regresses. Body-wins is deliberate: legacy-wins would make a migrated topic permanently un-untickable, since 43-H writes `- [x] Foo` into the body and a later untick there would be overridden forever by the old `AgendaItemDiscussedSet(true)`.
- [x] Ordering is document order; `position` = index of the task item in the doc.
- [x] Frontend: `AgendaSection` reads the same `agenda` array as today — **no change to its read path**. Ticking in the body is already a content edit (46-B `TaskItem` toggles the doc → `onUpdate` → save), so the count moves for free once the projection derives.
- [x] Nested task items (46-B `TaskItem.configure({ nested: true })`) — decide and spec: nested children count as topics or not. Recommend **yes, flat** (a topic is a topic).
- [x] Round-trip test in `EventStore.Integration`: content with task lines → `UpsertAsync` → `GetAsync` → `Agenda` survives.
- [x] ~~E2E: type a task line, assert the coverage pill moves.~~ **Deferred into 43-G's journey** (decided at review, PR #428): one gated journey asserts both — type a task line → pill moves → add from the header → the line lands in the first checklist with the caret unmoved. One journey instead of two is strictly less flake surface in the deploy gate, which is the project's bottleneck (BUG-38/61/62, the 44-min hang and the CHANGE-23 re-cut were all gate journeys). The `Api.Integration` tests cover the composed agenda through the real API boundary in the meantime.
- [x] **Deploy-time: neutral**, but a **projection rebuild is MANDATORY after the deploy** — this changes the *fold* of an already-populated projection, so every note written before the deploy keeps its stale (empty) `Agenda` until its next `ContentEdited`. The read path serves `NoteDetailView.Agenda` straight from the store and never re-parses content, so without the rebuild the feature is a silent no-op on every existing note — including the ones that already have task lists from 46-B. Invoke `POST /admin/projections/rebuild` (authenticated) and verify a known note's `agenda` is non-empty. Same class as the "a new projection ships empty" guardrail, which is written for *new* projections and should be widened to cover a fold change on an existing one.

_(43-F done — PR #428, deploy #724, `deploy-production` confirmed. Nested items DO count (flat). Two things the build added beyond the plan: `AgendaItemView.Derived` (a derived topic has no event stream, so the header shows it read-only until 43-G), and body-wins on a matched pair. **Outstanding: the post-deploy projection rebuild** — measured 2026-08-07, 1 of 183 prod notes has task lines with no agenda.)_

### Slice 43-G — The header writes back into the body

- [x] Every header mutation is applied as an **editor transaction** on the live `NoteEditor` document, not as an API call — so Ctrl+Z undoes it and the change rides the existing content-save path.
- [x] **Insert rule (Q7):** append to the note's *first* `taskList` node; if none exists, insert a new `taskList` at position 0. Cursor position is preserved (`focus(undefined, { scrollIntoView: false })`).
- [x] **The draft merge is the risky part.** `NoteView.tsx:160` reads `content = contentDraft ?? detail?.content ?? ""`; a header mutation must apply to the *editor's current document* (which reflects unsaved typing) and let the normal autosave flush it — never write `detail.content` back, or unsaved typing is lost.
- [x] `AgendaSection` needs access to the editor instance (it currently only reads the note-detail cache). Decide the seam: lift the editor ref into `NoteView` and pass a small command object down, rather than coupling `AgendaSection` to Tiptap.
- [x] ~~Retire `useAddAgendaItem` / `useSetAgendaItemDiscussed` / `useEditAgendaItemText` / `useRemoveAgendaItem`~~ — **deliberately NOT done in 43-G.** Legacy (pre-43-F) topics still exist on real notes until 43-H migrates them; retiring the hooks now would make those read-only in the header, a live regression, and it inverts the strangler ordering this doc mandates. `useAddAgendaItem` IS gone (adding always writes a body line); the other three stay for legacy topics only. **43-H retires them** along with the write endpoints.
- [x] Optimistic UI. **Not inherent as originally written** — review found the strip read only the server projection, which nothing refetched, so a tick visibly bounced back and an added topic never appeared. Met properly by rendering the strip from the **live editor document** whenever the editor is mounted: every header action moves the UI synchronously because there is no request to be ahead of. That same change is what makes the addressing safe (below).
- [x] E2E: **one** journey covering 43-F *and* 43-G — type a task line → coverage pill moves → add from the header mid-paragraph → the line lands in the first checklist and the caret has not moved. Reload-tolerant + consistency-gated (guardrail: every projector-backed assertion re-gates). This is the 43-F criterion folded in; do not write a second agenda journey.
- [x] **Deploy-time: neutral** for build/CDK (frontend-only), but the new journey adds recurring wall-clock to the **E2E gate on every deploy** — accepted, and offset by it covering 43-F as well so there is one agenda journey rather than two.
- [x] **Topics are addressed by index, so both indices must come from ONE document.** Review found the header rendering from the server projection while commands resolved against the local document: a blockquoted checklist (skipped by `AgendaFromContent`, but a real `taskItem` to Tiptap), an empty task line, or any unsaved typing desynchronises them — and `×` then deletes the wrong line. The strip renders from the live document, and `agendaEditorApi` reproduces the server's rule exactly — **nested items count** (flattened into document order, as `AgendaFromBodySpec` pins), blockquoted lines do not, empty items do not. A first attempt at this walked only top-level items and silently dropped nested topics: matching the rule *approximately* is its own regression.

### Slice 43-H1 / 43-H2 — Migrate the stragglers, THEN drop the old path

**Split from one slice into two on 2026-08-08.** Migrating and removing in the same deploy would leave the affected notes with no agenda between the deploy landing and the migration being run — against the strangler ordering this phase mandates. 43-H1 migrates and is verified; only then does 43-H2 remove.

**43-H1 status: reworked on 2026-08-09 after the PR #441 review.** The review asked whether reading the async projection was right at all. It was not, and the slice was re-cut around that: **both** sides of the read-modify-write now come from the event stream. Nothing has been run against prod beyond a read-only scan of `notetaker-events`; no dry run, no writes.

**Design — why the event stream, not the projection.** The migration is a read-modify-write of the one field the projection lags on, and it needed three things the projection could not give:

| Need | Async `NoteDetail` projection | Event stream |
|------|------|------|
| The body to append to | Lags the projector → the scanned body may already be stale, and replacing it whole silently drops the user's save | Read at head, per stream, by the command handler |
| Legacy topics (text, tick, order) | Correct only if a rebuild has run since 43-F | Source of truth |
| Ownership, and whether the note is deleted | `UserId` present but unfiltered; a deleted note is hard-deleted, so it is invisible rather than excluded | Authoritative — and the command handler already authorises from it |

So the run folds the full event log through the **same `NoteDetailProjection`** the projector and `ProjectionRebuildHandler` use, in memory. That gives one definition of "still legacy" (`AgendaFromContent.Compose` leaves a legacy topic in the view only when no body line matches it), needs no prior rebuild to be correct, and drops deleted notes by construction.

**The scan being at head is not the safety property — the hash is.** Every `EditContent` carries `ExpectedBaseContentHash` of the content the scan built from, so a note that moved during the run is **rejected** (`StaleContentEditException`), reported `stale`, and left for a re-run. This also closes the retry hole: `NoteCommandHandler` retries a `ConcurrencyException` by re-running the command, which without the hash re-applied the same stale body. Be precise about which read is which: discovery is a `Scan` (`ReadAllStreamsAsync`), which is eventually consistent, so the scan itself is not a guarantee. What the write is validated against is `NoteCommandHandler`'s per-stream `ReadAsync` — a `Query` with `ConsistentRead = true`, re-issued on every retry attempt. So reading the stream shrinks the stale window from *projector lag* to *scan lag plus the duration of the run*, and the hash makes whatever is left non-destructive rather than silent.

**Findings the rework did NOT simply accept:**
- The review suggested the identity-explicit `HandleAsync(cmd, note.UserId, …)` overload. That is **weaker** — it disables the handler's own event-stream ownership check. The scoped `ICurrentUser` overload is used instead, so the owner filter and the handler's check are two independent gates.
- "Prepending above an existing list merges into it and reformats content" is **not what happens.** Round-tripped through the real `NoteEditor` extension set, `- [ ] topic` + blank line + `- body item` parses as a `taskList` followed by a separate `bulletList` and re-serialises byte-identical. Pinned by a case in `taskListMarkdownRoundTrip.test.ts`. The probe did surface a genuine, **pre-existing** defect on the same note — blank-line paragraphs between two bullet lists are lost on open-and-save — filed as [BUG-68](phase-bugs.md); it is not caused by this slice.

**Measured scope (prod `notetaker-events`, re-measured 2026-08-09): 8 notes, 36 topics, one owner.** 39 `AgendaItemAdded` across 9 streams; the 9th is a **deleted** note carrying 3 throwaway topics, which the fold drops. Not one of the 8 bodies contains a task line today, so the idempotency, escape and emphasis paths are belt-and-braces on this data rather than load-bearing — they matter for a re-run after a partial apply. No topic contains a newline or markdown markup. One note (`d591ed55`) opens with a bullet list.

- [x] **Scope re-measured 2026-08-09** — see above. Re-measure again before running; a note edited in between may already carry its topics.
- [x] One-off migration prepends a checklist to each affected note's content, preserving ticked state and capture order, via a normal `EditContent` command (never a direct DynamoDB write — guardrail).
- [x] Reads the **event stream** for both the candidate set and the base content; `ExpectedBaseContentHash` on every write.
- [x] Scoped to the calling user; a deleted note is never resurrected; per-note try/catch so one failure cannot cost the record of what was already written; every outcome logged at the moment it happens as well as returned.
- [x] Idempotent: a topic already present as a task line is not written again. **One comparison key** — `AgendaFromContent.MatchKey`, used by the 43-F/H union *and* the migration — unescapes, strips paired emphasis (`- [ ] **Budget**` matches `Budget`), and collapses whitespace (a legacy topic may hold a newline, which the writer flattens onto one task line). Two divergent normalisers is how a topic gets silently skipped and then deleted for good by 43-H2.
- [x] Single-flight, like `ProjectionRebuildHandler`; a concurrent run is a 409.
- [x] Dry run is the default and returns **each note's full resulting content**, not counts and byte deltas — this writes into real notes, so what it would write has to be readable before `?apply=true`.
- [x] Tests drive the live endpoint (real auth, `?apply` binding, real `NoteCommandHandler`, real event store), including the stale-write rejection via an event-store double that interposes a save between the scan and the write.
- [ ] After applying: verify per note that the pre-migration paragraph count equals the post-migration count before 43-H2 drops the legacy fold.
- [ ] Only **after** verification: remove the legacy `AgendaItem*` fold from `NoteDetailProjection`, remove the agenda write endpoints (`POST /notes/{id}/agenda-items` and siblings), and remove the command-handler arms. The events stay in the stream, unread — reversible.
- [ ] **Carried from 43-G's review — 43-H2 touches the same rule, so fix them there.** (a) The BUG-24 image-resolve calls `setContent` with `emitUpdate: false`, so the editor's live topic list is not republished for it; one extra `publish()` in that `.then` makes the live list unconditionally authoritative. (b) `collectTaskItems` recurses only into `taskList` children, so a task item reachable through a **non-checklist** list — `- Shopping` / `  - [ ] Milk`, or a bulleted child under a task item — is counted server-side but invisible in the header. Widening the recursion to a list-type set closes it and cannot reintroduce the blockquote exclusion (a blockquote is not a list). (c) A paragraph holding only a non-text inline node (`- [ ] ![shot](key)`) reads as empty client-side and is skipped, while the server counts it.
- [x] `EventDeserializer` keeps its `AgendaItem*` arms; a rebuild must still parse historical events without throwing (guardrail).
- [x] **Deploy-time: neutral**, but this is a **data migration** — run it as an authenticated admin action after the deploy, like the projection rebuild, not as a deploy step.

**Rollout.**
1. Merge + deploy.
2. **`POST /admin/projections/rebuild`.** Mandatory, not optional: `Compose` now dedups on `MatchKey` instead of `Key`, which is a **fold change to an already-populated projection**. The deploy does not re-fold history, so every pre-existing `NoteDetail` row keeps the old union until its next event — and a note whose legacy topic now matches an emphasised body line would keep double-listing forever, because the match makes it a non-candidate so no write ever comes to heal it. Rebuilding first also means the dry run below is read off a projection consistent with the new fold.
3. `POST /admin/agenda/migrate` (dry run) and read the resulting content of all 8 notes. Check `notesExcludedNotOwned` is 0 and the totals reconcile with the measured 8 notes / 36 topics.
4. `?apply=true`. Note this **re-derives** from the stream rather than replaying step 3's output — a save in between is rebased onto (and rejected as `stale`), not overwritten.
5. Verify each of the 8 carries its topics as task lines and its paragraph count is unchanged from the pre-migration snapshot.
6. Only then 43-H2.

### Observability

Silent failure modes considered at Scout time:

- An add/tick that **200s but doesn't persist** — projection not updated, or a new field unmapped in `DynamoDbNoteDetailStore` (the in-memory double hides it). → round-trip test + a structured log on each agenda mutation (`noteId`, `itemId`, op).
- **Agenda missing on reload** — projector lag, or not composed into the note read. → composed onto `NoteDetailView` and gated at read by the consistency token.
- **Optimistic update masks a failed write** — reconcile on error; surface a toast.
- ~~New projection ships **empty** — backfill after the 43-A deploy~~ — **N/A** (43-A composed onto `NoteDetailView`, no new table; nothing to backfill).

Added for 43-F–H:

- **A task line stops counting** — the derive parses the wrong node type after a Tiptap upgrade, so the agenda silently empties while the note looks fine. → assert a non-empty `Agenda` in the round-trip test; structured log of `agendaItemCount` per note read.
- **A header write-back eats unsaved typing** — the highest-severity failure in 43-G, and invisible server-side. → log `contentLength` before/after each header mutation; E2E asserts unsaved text survives.
- **The migration double-appends** — a re-run adds a second checklist. → idempotency check on topic text; log skipped notes.

### Deploy-time impact

**Neutral throughout.** 43-A–E: additive events on an existing stream folded into an existing view. 43-F: an extra fold over content already in the view — but it needs a one-off **projection rebuild** after the deploy (see the 43-F build notes), because the fold of an existing projection changed. 43-G: frontend-only. 43-H: an admin-invoked data migration, not a deploy step.

### Open decisions (settle at Breaker time)

1. **The count now includes every task line in the note.** A note with twenty checkboxes reads "3 / 20". Options: leave it, cap the pill, or show only what's left. Deliberately unresolved — needs real use first.
2. **Nested task items** — count as topics, or only top-level? Recommend flat.
3. **Blockquoted task lines are deliberately not topics** — Tiptap renders `> - [ ] Foo` as a real, clickable checkbox, but a blockquote in a meeting note is usually quoted material (someone else's checklist), so counting it as *your* agenda is worse than skipping it. The cost: ticking that checkbox moves nothing, with no explanation. Revisit if real use contradicts it.
4. **Does the derived agenda belong on the home card?** Seeing uncovered topics without opening the note is real value, but out of scope here.

### Out of scope / later

- Reorder (drag) agenda items.
- Seeding the agenda from the calendar event or a template.
- Carrying unfinished agenda items to the next occurrence's note.
- Promoting a topic into a first-class action item (the Actions section stays the home for actions — decided 2026-08-07).
