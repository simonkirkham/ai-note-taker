# Phase 40 — Home notes: richer default, date-range filter, and sort _(In Progress — 40-A done)_

**Goal:** Replace the home screen's "today's notes only, plus a *show older* toggle" with a richer browse — the last 30 days shown by default, an explicit date-range filter, and sorting by date or title.

## Summary

| Slice | What the user gets | Status | Depends on |
|-------|--------------------|--------|------------|
| 40-P | **Prototype (throwaway).** Settle the default window, the date-range control, the sort control, month grouping, and empty states before building. | Done | — |
| 40-A | **Richer default + date-range filter.** The home screen shows the last 30 days by default, and you can pick a date range (presets or a custom from–to) — replacing the disliked *show older* toggle. | Done (PR #394, deploy #699) | 40-P |
| 40-B | **Sort control + month grouping.** Order the home list newest/oldest first or by title; a wide date-sorted view groups under month headers. | Not Started | 40-A |

> **40-A is the keystone** — it removes the mechanism the user dislikes and proves the redesigned filter pipeline end-to-end. **40-B layers sort (and month grouping) on top.** Ship 40-A first; branch 40-B only after it deploys green.
>
> **Decisions settled by the 40-P prototype (2026-07-17):** default window = **rolling last 30 days**; date-range control = **presets + Custom…**; sort default = **Newest first**; month grouping = **Auto** (rides 40-B). Full record: `web/src/prototype/REFERENCE.md` on `prototype/40-home-notes-filter-sort`.

## Slices

<!-- REVIEW SURFACE — the human reads this and stops. No technical artefact named below. -->

### Slice 40-A — Richer default + date-range filter (keystone)

- **User value:** The home screen shows the **last 30 days** by default instead of only today, and the user can pick an explicit date range — replacing the disliked *show older* toggle.
- **How it works:**
  - On load, with no filter set, the home list shows notes from the **last 30 days** (rolling), not just today's.
  - A **When** control narrows the list: quick presets — *Today*, *Last 7 days*, *Last 30 days*, *This month*, *All* — plus **Custom…**, which reveals a from–to date picker. *All* is a one-click escape hatch showing every note.
  - Clearing the range returns to the default 30-day window.
  - The chosen range lives in the URL (`?range=` or `?from=&to=`), so Back from a note, reload, and sharing all restore the same view. Filter changes replace history; opening a note pushes — so Back lands on the populated list.
  - Tags and date range apply together. The old *show older* toggle — and its auto-enable-when-a-tag-is-picked behaviour — are gone.
  - A range (or tag) that matches nothing shows a clear empty state with a **Clear filters** action.
- **Scenarios (GWT):**

```
Scenario: Default window on load
  Given I open the home screen with no filter set
  Then  I see notes from the last 30 days
  And   I do not see notes older than 30 days
  And   there is no "show older" toggle

Scenario: Preset narrows to today
  Given the home list showing the default window
  When  I pick the "Today" preset
  Then  only notes dated today are shown

Scenario: Preset widens to all
  Given the home list showing the default window
  When  I pick the "All" preset
  Then  every note is shown regardless of date

Scenario: Custom from-to range
  Given the home list
  When  I choose "Custom" and set a from and to date
  Then  only notes whose effective date falls within that range are shown

Scenario: Clearing the range returns to the default window
  Given a date-range preset is applied
  When  I clear the range
  Then  the list returns to the last-30-days default window

Scenario: Range survives opening a note
  Given a date range is set
  When  I open a note and press Save or Back
  Then  the home list restores the same range from the URL

Scenario: Empty state
  Given a date range that matches no notes
  Then  a clear empty state with a "Clear filters" action is shown

Scenario: Tags and date range compose
  Given a tag filter and a date range are both set
  Then  only notes matching the tag selection AND falling in the range are shown

Scenario: Show older is retired
  Given the redesigned home screen
  Then  the old "show older" toggle no longer exists
  And   picking a tag no longer auto-reveals older notes
  And   the today-only default no longer applies
```

### Slice 40-B — Sort control + month grouping (scale)

- **User value:** Order the home list the way the user wants — newest or oldest first, or by title — and, when browsing a wide span, see it broken up by month.
- **How it works:**
  - A **sort** control offers: *Newest first* (default), *Oldest first*, *Title A–Z*, *Title Z–A*. Title sort is case-insensitive.
  - When the list is sorted by date **and** the visible span is wide (more than ~45 days — e.g. a *This month*+ / *All* / long custom range), cards group under **month headers**; short or non-date-sorted views stay a flat grid.
  - The chosen sort lives in the URL (`?sort=`) and restores on return; it composes with the date range and tags (filter, then sort).
- **Scenarios (GWT):**

```
Scenario: Sort by date, newest first
  Given the home list
  When  I sort by "Newest first"
  Then  the note with the most recent effective date is first

Scenario: Sort by date, oldest first
  Given the home list
  When  I sort by "Oldest first"
  Then  the note with the oldest effective date is first

Scenario: Sort by title
  Given the home list
  When  I sort by "Title A-Z"
  Then  notes are ordered case-insensitively by title, A to Z

Scenario: Sort survives opening a note
  Given I chose a sort order
  When  I open a note and return
  Then  the same sort order is restored from the URL

Scenario: Sort composes with filters
  Given a sort order, a date range, and a tag filter
  Then  the list is filtered by range and tag, then ordered by the sort

Scenario: Month grouping on a wide date-sorted range
  Given the list is sorted by date and a wide range (e.g. All) is applied
  Then  cards are grouped under month headers

Scenario: No month grouping on a short or title-sorted view
  Given the default 30-day window, or a title sort
  Then  cards are shown as a flat grid with no month headers
```

---

## Build notes _(implementation — skip when reviewing)_

### Scope & constraints
- **Frontend-only, client-side over the already-loaded `cards` set.** The home list already loads the full card set (`useNoteCards()` → `GET /notes/cards`) and filters/sorts in the browser (`ListView.tsx`); default-window, date-range, sort, and grouping are all client-side. No new event, command, projection, endpoint, or CDK change.
- **Out of scope:** server-side date/sort over a *paginated* set — that is the separate ["Scalable note loading (pagination) + server-side filtering"](../future-features.md) future-feature; this phase must not pre-empt it.
- **Filter + sort state in URL params**, extending the existing `?q=&tag=&mode=` scheme (CHANGE-23): replace `?older=1` with the range params (`?range=` for presets, `?from=&to=` for custom) and a `?sort=` param. Back/reload/share restore the exact view for free.
- **`show older` (CHANGE-19) and today-only default (CHANGE-3) are removed**, not kept in parallel — including CHANGE-19's auto-enable-on-tag-filter.
- The save-button "return to where I came from" is **not** in scope — the existing `navigate(-1)` + URL-persisted filters already cover it.

### 40-A
- `ListView.tsx` default-visibility logic replaced: the today-only + `showOlder` branch (~lines 161–181) and `nextOlderForSelection` auto-enable are deleted, replaced by a default-window + date-range filter over `effectiveDate(card)`.
- **Default window:** no `range`/`from`/`to` param ⇒ show notes with `effectiveDate(card)` in `[daysAgo(29), today]` (rolling last 30 days).
- **Presets** computed relative to `localTodayISO()`: `today` = `[today, today]`; `7` = `[today−6, today]`; `30` = `[today−29, today]`; `month` = `[firstOfMonth, today]`; `all` = unbounded; `custom` = `[from, to]` (open-ended if one side blank).
- Range state read/written via URL params (extend `writeFilters`); `?older=1` removed.
- Date math reuses `src/dates.ts` (`effectiveDate`, `localTodayISO`, `localDateISO`) — compare `YYYY-MM-DD` strings; no UTC drift; no hardcoded absolute dates (time-bomb guardrail).
- **Optimistic-UI n/a** (no mutation) — but the acceptance set still asserts URL-restore round-trips.
- Tests: vitest/RTL for default window, each preset, custom range, "All", clearing-returns-to-default, empty state, tag+range compose, URL restore. Run `npm run lint`.
- Browser.E2E (warranted): a filtered home list survives a note open→Save→Back via the **gated** home-card path, not ungated search (CHANGE-23 deploy-#633 lesson). Reuse/extend `FilterBackNavigationJourney`.

### 40-B
- `ListView.tsx` sort parameterised: the fixed reverse-chronological sort (~lines 171–180) becomes driven by a `?sort=` URL param, default `date-desc`. Keys: `date-desc`, `date-asc`, `title-asc`, `title-desc`; title via `localeCompare(…, { sensitivity: "base" })`; date keeps the `lastModifiedAt` tiebreak.
- **Month grouping:** when `sort` starts with `date` **and** the visible span (`effectiveDate` of first vs last result) exceeds ~45 days, render month-group headers (`YYYY-MM` label); else a flat grid. Grouping is display-only over the already-sorted list.
- Sort control keyboard-accessible (real `<select>` or button group; satisfies the jsx-a11y gate).
- Tests: vitest/RTL for each sort key+direction, default, compose-with-filter, URL restore, grouping-on-wide-range, no-grouping-on-short/title view. Run `npm run lint`.

### Decisions locked
- **2026-06-26 (scoping):** new numbered phase, prototype-gated; frontend-only client-side over the loaded `cards` set; filter+sort state in URL (extends CHANGE-23); `show older` + today-only default removed; save-button "return to origin" dropped.
- **2026-07-17 (40-P prototype):** default window = **rolling last 30 days**; date-range control = **presets + Custom…** with *All* escape hatch; sort default = **Newest first** (4 options); **month grouping = Auto**, folded into **40-B** (coupled to date sort); empty state = single card, message tailored to the narrowest active filter, with a *Clear filters* action.

### Observability
Frontend-only, client-side filtering/sorting over data already loaded — no new backend call, table, or external dependency, so **no new silent backend failure mode and no new instrumentation** (flagged, not added):
- **Primary silent failure — a filter/sort bug hides notes the user expects to see** (off-by-one date compare, timezone drift, bad sort key). Guarded by the vitest/RTL acceptance tests, not by telemetry.
- **JS errors in the new controls** are already captured by the existing CloudWatch RUM frontend error pipeline (Phase 12-F/12-H) — no new wiring.
- **No new metric or alarm** — the slice adds no resource, endpoint, or external call.

### Deploy-time impact
**Neutral.** No CI workflow, CDK, alias/traffic-shifting, build-step, backend, projection, or event change. Pure `web/` change shipped through the existing frontend deploy job.

### Learning surface
Small, contained frontend feature; the interest is a UX-uncertain redesign settled by a throwaway prototype before implementation, and keeping a richer client-side filter/sort pipeline URL-addressable (read-your-origin restore is free) while honouring the client-side-vs-server-side boundary against the pagination future-feature.
