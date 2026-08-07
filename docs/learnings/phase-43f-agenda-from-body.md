# 43-F — the agenda became a reading of the note body

**Shipped:** PR #428, deploy #724 (2026-08-07), `deploy-production` confirmed.

Phase 43 shipped an agenda as **separate data** (43-A–E: `AgendaItem*` events folded onto `NoteDetailView`). Six weeks later 43-F reversed that: every task-list line in the note body is a topic, and the tick is the `[x]` in the markdown.

## The reversal was a prototype-and-interview outcome, not a code insight

43-E had removed the in-body heading-✓. The obvious repair was to put it back. A ten-question interview against a clickable prototype found the real problem on **question one**: the user writes *running prose with few headings*. Every heading-anchored design — the restored ✓, name-matching, linked headings — was therefore dead on arrival, because `markHeadingDiscussed` only ever fired when the caret was inside a heading. Three of five candidate designs were eliminated by one answer about how someone types.

**Reusable:** when a mechanism "doesn't work", establish *what the user's data actually looks like* before designing a fix. The old ✓ wasn't broken so much as never applicable.

The interview then produced a simplification nobody had proposed: once the body is canonical and the tick is `- [x]`, **no identity token is needed in the markdown**. The static gallery had costed every linked variant with a hidden `<!--a:id-->` and the pollution it implies for search and the analysis prompt. That cost evaporated — the line *is* the item. The chosen design was cheaper than the one it beat, which is the opposite of the usual direction.

## The near-miss: a changed fold on an existing projection

The PR and the phase doc both said **"no backfill needed"** — reasoning that 43-F adds no table and no new projection. That was wrong, and review caught it.

`NoteDetailProjection` only recomputes on a *new event* for that note, and the read path serves `NoteDetailView.Agenda` straight from the store without re-parsing content. So every note written before the deploy keeps its stale (empty) agenda until its next edit. Measured in prod after the deploy: **1 of 183 notes** had task lines and no agenda.

The existing guardrail — *"a new read projection ships empty"* — did not cover this, because nothing new ships. **The guardrail has been widened** (CLAUDE.md) to include a slice that *changes the fold of an existing populated projection*, with the same rebuild-and-verify instruction.

**Reusable:** "does this add a projection?" is the wrong question. Ask "**does this change what a stored projection row should contain?**" If yes, history must be re-folded, and green tests prove nothing about existing rows.

## Three parser defects that only surfaced under adversarial reading

The first implementation passed 16 specs, the full suite, and CI. Review found three real defects by running the regex against markdown the app actually produces:

| Defect | Why it mattered |
|---|---|
| Fenced code scanned as markdown | A pasted runbook's `- [ ] npm ci` became a topic — and derived topics have no remove control, so it was unremovable |
| Identical text → identical id | `DeriveId` hashed (note, text); two `- [ ] Follow up` lines collided, duplicating React keys so ticking one could strike the other |
| Markdown escapes leaked | `prosemirror-markdown` escapes `[` `]` `*` etc., so "Review Q3 [draft]" displayed as `Review Q3 \[draft\]` |

The escape defect also set a **trap for 43-H**: the migration writes topic text unescaped, the editor re-serialises it escaped, and the idempotency check would then silently fail and double-list the topic. Fixed by unescaping both sides of the dedup comparison. The *emphasis* half of the same trap is still open — filed as CHANGE-38 and noted in 43-H's build notes.

**Reusable:** a parser over user content needs specs written from **what the serializer emits**, not from what the format looks like by hand. Reading `prosemirror-markdown`'s `esc()` was worth more than any amount of staring at the regex.

## Sequencing that kept the slice shippable

- **Strangler, enforced.** 43-F derives from the body *and* keeps folding legacy `AgendaItem*` events, union-ed. 43-H migrates and only then drops the legacy path. The two paths meet in exactly one function (`Compose`), so 43-H deletes a dictionary and a switch arm rather than untangling a merge.
- **Body wins on a matched pair.** The plan said "legacy wins on ticked state". That would have made a migrated topic **permanently un-untickable**: 43-H writes `- [x] Foo`, the user unticks it in the notes, and the old `AgendaItemDiscussedSet(true)` overrides forever. The code was changed and the doc corrected with that reason recorded, because whoever writes 43-H will read the line and not the code.
- **A derived topic had to become read-only in the header** — it has no event stream, so the existing checkbox would have 404'd on click. This wasn't in the plan; a slice that ships a control which errors on click isn't shippable.

## Deferred deliberately

The 43-F E2E journey was **folded into 43-G's** rather than written now: one gated journey asserts both (type a task line → pill moves → add from the header → line lands, caret unmoved). Every recent deploy-gate journey (BUG-38, BUG-61, BUG-62, the 44-minute hang, the CHANGE-23 re-cut) cost more than the bug it caught, so halving the gate's flake surface beat two days' earlier coverage. Recorded as a decision in 43-G's build notes, not left as an unticked box.
