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
| CHANGE-18 | Tag-search box in the home Filters panel that filters the displayed tag pills (lists >8 tags) | In Progress | — |
| CHANGE-19 | Auto-show "older notes" when a tag filter is applied; revert when the filter is cleared | In Progress | — |

Open: CHANGE-17, CHANGE-18, CHANGE-19.

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

### CHANGE-18 — Tag-search box in the home Filters panel

**Value:** With many tags, the pill list is hard to scan. A search box narrows the visible pills so a tag is found by typing instead of hunting.

**Approach:** Local UI state in `TagFilter` (not lifted). Search renders only when `tags.length > 8` (avoid clutter on short lists). Filtering the *displayed* pills never touches how tag filtering applies to notes; selection state is unaffected.

Scenarios (GWT):
- More than 8 tags: Given the Filters panel with >8 tags, When opened, Then a `tag-filter-search` input renders above the pills.
- 8 or fewer tags: Given ≤8 tags, Then no search input renders.
- Filter pills: Given the search input, When I type `"wo"`, Then only pills whose tag contains `"wo"` (case-insensitive) render.
- Clear restores: Given a typed search, When I clear it, Then all pills render again.
- Selection unaffected: Given a selected tag filtered out of view, Then it stays selected and Clear/AND-OR still act on all selected tags.

Acceptance criteria:
- Search is local state in `TagFilter`; no lift to `ListView`.
- Accessible: labelled input with placeholder; `data-testid="tag-filter-search"`.
- No change to how tag filtering applies to notes (only which pills are shown).

### CHANGE-19 — Auto-show older notes when a tag filter is applied

**Value:** Tag filtering on the home page is near-useless if it only searches today's notes. Applying a tag filter should reveal older matches automatically, then restore the prior state when the filter clears.

**Approach:** Track whether the older-on state is *filter-driven* vs *user-driven* with explicit state, so the revert only undoes the auto-enable. Do **not** use a naive derived `showOlder || selectedTags.length>0` (that makes the toggle un-untickable while filtering).

Scenarios (GWT):
- Auto-on: Given no tag selected and "Show older" OFF, When I select the first tag, Then older notes are included AND the checkbox shows checked.
- Revert on clear: Given a filter that auto-enabled older, When I clear the filter, Then "Show older" reverts to OFF.
- User override respected: Given filtering with older auto-on, When I manually untick "Show older", Then older notes hide and it stays off while filtering.
- Pre-existing preference kept: Given "Show older" was ON before any filter, When I apply then clear a filter, Then it stays ON.

Acceptance criteria:
- Explicit filter-driven-vs-user-driven state; revert only undoes the auto-enable.
- Optimistic-UI N/A (no mutation).
- Collapsed "Filters · N tags · older" summary stays correct.

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
