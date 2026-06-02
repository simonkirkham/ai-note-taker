# CHANGE-9 — Restructure the home Filters panel (Option D)

**Shipped:** PR #121, merge `24c52f3`, deployed 2026-06-02. Frontend layout/interaction only.

## What changed
Consolidated all home filtering into the one collapsible Filters panel (prototype-approved **Option D**):
- "Show older notes" moved out of the Notes header into an **"Other"** group inside the panel; the Notes header shows only the heading.
- Tag controls wrapped in a labelled **"Tags"** group; the expanded panel became a bordered card of stacked, labelled groups.
- The collapsed control now shows a rich active-filter summary — `Filters · 2 tags · older` (bare `Filters` when none active) — replacing CHANGE-6's `(N)` tag count.
- Closed the dead vertical gap between the Filters control and the notes list.

Files: `web/src/components/ListView.tsx`, `web/src/App.css`, and test updates in `ListView.test.tsx` + `CollapsibleFilters.test.tsx`. Behaviour (date filter, tag filter, AND/OR, Clear, date↔tag composition) is unchanged.

## Prototype-first
The layout was chosen from a four-option gallery (`prototype/minor-9-filters-layout` → `filters-layout-prototype.html`): A stacked groups, B toggle-on-top, C two-column, D rich collapsed summary. The user picked **D**. `REFERENCE.md` captured the confirmed design and the summary-string rule before implementation.

## Technical notes
- The summary string is derived in `ListView` from existing state: `[tagCount && "N tag(s)", showOlder && "older"].filter(Boolean).join(" · ")`, prefixed `Filters · …`; bare `Filters` when empty. It lives inside the toggle button's accessible name, so screen-reader users hear the active state too.
- **Moving a control into a conditionally-rendered panel cascades through the tests.** The show-older checkbox is only in the DOM when the panel is expanded, so every date-filter test that toggled it had to expand the panel first. Centralising that in the `olderToggle()` helper (guard on `aria-expanded`, click to open, then return the checkbox) kept the change to one helper + mechanical `await` additions at call sites — cheaper than touching each test. **Lesson: when relocating a control behind a disclosure, fix the shared test helper, not each call site.**
- The "always available" affordance shifted from the checkbox to the Filters control button — the test assertion moved with it.

## Process
Last of the sequential CHANGE-8 → CHANGE-9 pair. Sequential (not parallel) was the right call for two App.css-touching slices: CHANGE-9 branched after CHANGE-8 merged, so there was zero App.css conflict — unlike the earlier 3-slice parallel batch. See [[phase-minor-6-collapsible-filters]] for the parallel-run cost notes. First-pass Hawk approval, no rework.
