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

Open: none.

New tweaks are appended as a one-line shipped record below once Done. The full spec/Value/Approach for each lived in this doc during the slice and remains in git history; the durable *why* (where any) is in the learnings archive. CHANGE-1 to CHANGE-4 were moved here from the former "Phase 13 — UI Polish II" once it was clear they were minor tweaks rather than a distinct phase.

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
