# Phase Minor Changes — Tweaks backlog

**Goal:** A standing, unnumbered phase that captures small tweaks and changes that aren't worth a numbered phase of their own and aren't defects. Like the bugs phase, it has no learning theme and no fixed slice sequence — items are added as they surface and marked Done as they ship. Each change still goes through the normal pipeline: a spec/test where behaviour changes, then the change.

**What belongs here:** small, self-contained adjustments to existing behaviour or appearance — a copy change, a default tweaked, a control relabelled, a spacing fix. If it introduces genuinely new user-facing capability it's a **feature** ([docs/future-features.md](../future-features.md) → a numbered phase). If it's a defect, it's a **bug** ([docs/phases/phase-bugs.md](phase-bugs.md)). If it's a refactor, upgrade, or CI/infra item, it's a **technical improvement** ([docs/technical-improvements.md](../technical-improvements.md)).

**Learning surface:** none specific — this is polish and maintenance work.

---

## Summary

| Item | Summary | Status | Depends on |
|------|---------|--------|------------|
| CHANGE-1 | Single-spaced note lines by default | Done | — |
| CHANGE-2 | Theme selection (Teal / Forest / Midnight) | Done | — |
| CHANGE-3 | Home screen shows today's notes by default | Done | — |
| CHANGE-4 | To-do rows wrap cleanly with long text + note title | Done | — |
| CHANGE-5 | Sign-in screen visual polish | Done | — |
| CHANGE-6 | Collapsible "Filters" control for home tags | Done | — |
| CHANGE-7 | More colour schemes; drop duplicate Forest theme | Done | CHANGE-2 |
| CHANGE-8 | Theme picker + Sign out always visible without scrolling | Done | CHANGE-2 |
| CHANGE-9 | Restructure home Filters: Show-older + Tags inside, fix gap | Done | CHANGE-3, CHANGE-6 |
| CHANGE-10 | Refine home: hide tag labels, icon card/to-do actions, boxless filter tags, simpler calendar | Done | — |
| CHANGE-11 | Preview pull-out `»` becomes `«` when its panel is open | Done | — |
| CHANGE-12 | Drop home Notes divider; top-align with Today's Meetings | Done | — |
| CHANGE-13 | "Next occurrence" button inside a recurring-meeting note | Done | 9-F |
| CHANGE-14 | Rename transcription "Call audio" toggle to "Record screen-share audio" | Done | — |
| CHANGE-15 | Keyboard access for `FolderPreviewPanel` hover items — open a note via keyboard, not only mouse/drag (surfaced by the 19-F3 jsx-a11y gate; currently a justified scoped disable) | Done | — |
| CHANGE-16 | Pin `@tiptap/extension-link` directly in `web/package.json` — 19-J imports it but it is still transitive via StarterKit, so a future StarterKit bump dropping it would break the import (unmet 19-J acceptance criterion) | Done | — |
| CHANGE-17 | Case-insensitive tags — force all tags to lowercase; `Foo`/`foo` are one tag everywhere (add, dedupe, filter, index) | In Progress | — |
| CHANGE-18 | Tag-search box in the home Filters panel that filters the displayed tag pills (lists >8 tags) | Done | — |
| CHANGE-19 | Auto-show "older notes" when a tag filter is applied; revert when the filter is cleared | Done | — |

Open: CHANGE-17.

New tweaks are appended as a one-line shipped record below once Done. The full spec/Value/Approach for each lived in this doc during the slice and remains in git history; the durable *why* (where any) is in the learnings archive. CHANGE-1 to CHANGE-4 were moved here from the former "Phase 13 — UI Polish II" once it was clear they were minor tweaks rather than a distinct phase.

---

## Active spec

### CHANGE-17 — Case-insensitive tags

**Value:** Tags differing only in case (`Foo`, `foo`, `FOO`) are the same tag — no accidental duplicates, and filtering by `work` finds notes tagged `Work`. Decision (2026-06-22): force **lowercase** everywhere; existing mixed-case tags normalise on projection rebuild.

**Approach:** Normalise in the `Note` aggregate (single source of truth); projections lowercase on fold so legacy events normalise on rebuild. **Events are not edited** — only new writes carry lowercase; legacy events keep their stored case and the fold lowercases them on read. Value-only normalisation, identical event shape → **no event versioning**.

Scenarios (GWT):
- Add lowercases: Given a note, When I add tag `"Foo Bar"`, Then `NoteTagged` carries `"foo bar"` and the note's tags are `["foo bar"]`.
- Trim + lowercase: Given a note, When I add `"  Work "`, Then the tag is `"work"`.
- Case-variant add is rejected: Given a note tagged `"work"`, When I add `"WORK"`, Then it throws "already present" (no second event).
- Legacy dedupe on fold: Given a note whose history is `NoteTagged "Foo"`, When the aggregate rebuilds and I add `"foo"`, Then it throws "already present".
- Untag is case-insensitive: Given a note whose history is `NoteTagged "Foo"`, When I untag `"foo"`, Then `NoteUntagged` is emitted and the tag is removed.
- Tag index merges variants: Given notes tagged `"Work"` and `"work"`, When `TagIndex` rebuilds, Then one `"work"` row with the combined note count.
- Card projection dedupes: Given a card whose history tags it `"Foo"` then `"foo"`, When the card list rebuilds, Then the card shows a single `"foo"` tag.
- Frontend add (optimistic): Given the tag input, When I type `"Foo"` and submit, Then the optimistic pill shows `"foo"`.
- Frontend filter: Given cards tagged `"work"`, When I select the `work` filter pill, Then matching cards show (comparison is lowercase).

Acceptance criteria:
- All new `NoteTagged`/`NoteUntagged` events carry `Trim().ToLowerInvariant()` tags.
- Aggregate dedupe/contains is case-insensitive (folds legacy mixed-case history into lowercase `_tags`).
- `TagIndexProjection` and `NoteCardListProjection` lowercase + dedupe on fold; both remain rebuildable from the full stream.
- Frontend: `TagsSection` lowercases before `onAdd` (optimistic pill matches stored value); `ListView` tag filter compares lowercase.
- No event versioning (shape unchanged); `cdk synth` green; all BDD specs green.
- **Mandatory Scribe step:** run prod projection rebuild (`POST /admin/projections/rebuild`) and verify tag-index row counts/merge so live tags display and merge as lowercase — legacy rows do not normalise without it.

Out of scope (deferred): tag-search box in the home filter and auto-show-older-on-filter (the frontend-only Slice B — now CHANGE-18 / CHANGE-19 below).

---

## Shipped

Each line: **item — what shipped — PR / deploy.** Learnings (where captured) are in [docs/learnings/_archive.md](../learnings/_archive.md).

- **CHANGE-1** — Single-spaced note lines (`.content-input p { margin: 0 }`; pure styling, no event change). PR #98, deployed 2026-06-02.
- **CHANGE-2** — Theme selection (Teal / Forest / Midnight). PR #102, deployed 2026-06-02.
- **CHANGE-3** — Home screen defaults to today's notes. PR #101, deployed 2026-06-02.
- **CHANGE-4** — To-do rows wrap cleanly with long text + note title (prototype `prototype/todo-row-wrap`, implemented verbatim). PR #104, deployed 2026-06-02.
- **CHANGE-5** — Sign-in screen visual polish. PR #109, deployed 2026-06-02.
- **CHANGE-6** — Collapsible "Filters" control for home tags. PR #111, deployed 2026-06-02.
- **CHANGE-7** — 12 themes (8 light, 4 dark); Forest dropped as a Teal duplicate. PR #112 + contrast follow-up #114, deployed 2026-06-02.
- **CHANGE-8** — Theme picker + Sign out always visible without scrolling. PR #119, deployed 2026-06-02.
- **CHANGE-9** — Restructured home Filters (Option D: rich collapsed summary + Tags/Other groups). PR #121, deployed 2026-06-02.
- **CHANGE-10** — Home refinement: icon card/to-do actions, hidden tag labels, boxless filter tags, lighter calendar (6 confirmed changes). PR #129, deployed 2026-06-02.
- **CHANGE-11** — Preview pull-out `»`↔`«` reflecting panel open state. PR #126, deployed 2026-06-02.
- **CHANGE-12** — Dropped home Notes divider; top-aligned with Today's Meetings. PR #123, deployed 2026-06-02. (Branch/commit keep "minor-10"; renumbered CHANGE-12 at Scribe after a concurrent-session numbering collision.)
- **CHANGE-13** — "Next occurrence" control inside a recurring-meeting note (option 1: reverse lookup on `CalendarLinkView`). PR #162, deployed 2026-06-04.
- **CHANGE-14** — Transcription audio toggle relabelled "Call audio" → "Record screen-share audio". PR #164, deployed 2026-06-04.
- **CHANGE-15** — `FolderPreviewPanel` note rows converted from click/drag-only `<li>` to real `<button>` (keyboard-openable, `:focus-visible` ring, drag-to-move preserved); scoped jsx-a11y disable removed. PR #247, deployed 2026-06-11.
- **CHANGE-16** — `@tiptap/extension-link` promoted from transitive (via starter-kit) to a direct `^3.23.4` dependency, closing the unmet 19-J acceptance criterion. Manifest-only, no behaviour change. PR #283, deployed 2026-06-13.
- **CHANGE-18** — Tag-search box in the home Filters panel (`tag-filter-search`); renders only when `tags.length > 8`, narrows displayed pills case-insensitively, view-only (selection/note-filtering unaffected). Local state in `TagFilter`. PR #313, deployed 2026-06-22.
- **CHANGE-19** — Auto-show older notes when a tag filter is applied; clearing reverts only the auto-enable. Explicit `olderAutoEnabled` flag distinguishes filter-driven from user-driven, so a manual untick or pre-existing "older ON" preference is respected. State set in user-action handlers (not a `useEffect`). PR #313, deployed 2026-06-22.
