# 40-P Prototype — REFERENCE (confirmed UX)

Throwaway prototype for Phase 40 (home notes: richer default, date-range filter, sort). Interaction settled with the user 2026-07-17. **Real work rebuilds from scratch in `web/src/components/ListView.tsx` using the phase-40.md GWTs — do not port this HTML.**

Prototype file: `web/src/prototype/phase40-home-notes.html` (self-contained, mock data). Published artifact was the feedback vehicle.

## Locked decisions (2026-07-17)

| Choice | Decision |
|--------|----------|
| **Default window** | **Rolling last 30 days** — notes whose effective date is within `[today−29, today]`. Shown on load with no range param set. Replaces today-only default (CHANGE-3) and *show older* + its auto-enable-on-tag (CHANGE-19). |
| **Date-range control** | **Presets + Custom** — chips: `Today`, `Last 7 days`, `Last 30 days`, `This month`, `All`, `Custom…`. Selecting `Custom…` reveals a from–to date pair. `All` is the one-click escape hatch. |
| **"Default" vs explicit range** | Default window is the *implicit* state (no `range`/`from`/`to` param). Any preset/custom selection is an explicit override written to the URL. Clearing the range returns to the default window. |
| **Sort** | Dropdown, 4 options: **Newest first** (default), Oldest first, Title A–Z, Title Z–A. Filter *then* sort. Title sort is case-insensitive (`localeCompare`, `sensitivity: base`). |
| **Month grouping** | **Auto** — group cards under month headers only when sorted by date **and** the visible span exceeds ~45 days; otherwise a flat grid. Ships in **40-B** (coupled to the sort key/direction), not 40-A. |
| **Empty state** | One card, message tailored to the narrowest active filter (search term › tags › range), plus a **Clear filters** button. |
| **Tags** | Compose with range + sort (a note must match the range AND the tag selection). Prototype used OR across selected tags; real impl keeps the existing AND/OR mode from CHANGE-23 — grouping/range/sort layer on top, tag semantics unchanged. |

## URL scheme (extends CHANGE-23 `?q=&tag=&mode=`)

- `?older=1` is **removed**.
- Range: `?range=today|7|30|month|all` for presets; `?from=YYYY-MM-DD&to=YYYY-MM-DD` for custom. No range param ⇒ default window (last 30 days).
- Sort: `?sort=date-desc|date-asc|title-asc|title-desc`. Omit `date-desc` (the default) from the URL.
- Filter writes use `replace`; opening a note pushes (unchanged from CHANGE-23), so Back restores the exact view.

## Component decisions for the real build

- All client-side over the already-loaded `useNoteCards()` set — **no backend/endpoint/event/projection change** (per phase-40 scope).
- Date math reuses `src/dates.ts` (`effectiveDate`, `localTodayISO`, `localDateISO`); compare `YYYY-MM-DD` strings (no UTC drift, no hardcoded absolute dates — time-bomb guardrail).
- Range presets computed relative to `localTodayISO()`: `Last 7` = `[today−6, today]`, `Last 30` = `[today−29, today]`, `This month` = `[firstOfMonth, today]`.
- The disliked mechanisms (today-only branch ~ListView.tsx:161–181; `showOlder`; `nextOlderForSelection` auto-enable) are deleted, not left in parallel.
- Sort control + range chips are real keyboard-operable controls (jsx-a11y gate).

## No localStorage keys

The prototype persisted nothing (state was in-memory); the real feature persists via URL params only. No `localStorage` keys carry over.
