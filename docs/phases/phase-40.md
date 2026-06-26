# Phase 40 — Home notes: richer default, date-range filter, and sort _(Not Started — prototype-gated)_

**Goal:** Replace the home screen's "today's notes only, plus a *show older* toggle" with a richer browse — more notes shown by default, an explicit date-range filter, and sorting by date or title.

## Summary

| Slice | What the user gets | Status | Depends on |
|-------|--------------------|--------|------------|
| 40-P | **Prototype (throwaway).** Try the redesigned home list to settle the default window, the date-range control, the sort control, and the empty states before anything is built for real. | Not Started | — |
| 40-A | **Richer default + date-range filter.** The home screen shows more than just today, and you can pick a date range — replacing the disliked *show older* toggle. | Not Started | 40-P |
| 40-B | **Sort control.** Order the home list newest/oldest first, or by title. | Not Started | 40-A |

> **40-A is the keystone** — it removes the mechanism the user dislikes and proves the redesigned filter pipeline end-to-end. **40-B layers sort on top.** Ship 40-A first; branch 40-B only after it deploys green.

## Slices

<!-- REVIEW SURFACE — the human reads this and stops. No technical artefact named below. -->

### Slice 40-P — Prototype (throwaway, frontend-only)

- **Purpose:** Settle the UX before any spec or real code — a quick throwaway prototype over mock notes at realistic volumes (a day, a month, a year of notes). On approval it rewrites 40-A/40-B's scenarios in this doc; real work starts from the updated doc, not the prototype code.
- **What the prototype settles:**
  - **Default window** — "show more" = rolling last-N-days (7 / 14 / 30), last-N-notes, or all.
  - **Date-range control** — quick presets (Today / Last 7 / Last 30 / This month / All), a custom from–to picker, or both; whether "All" stays a one-click escape hatch.
  - **Sort control** — which keys (date, title), default direction, where it sits.
  - **Retiring *show older*** — confirm the toggle and its auto-enable-on-tag-filter are fully removed, not left alongside the new model.
  - **Search + tags interaction** — sort/date-range apply to browsing; in active search, relevance still wins; tags + range + sort compose.
  - **Empty-state copy** when a range or tag yields no notes.

### Slice 40-A — Richer default + date-range filter (keystone)

- **User value:** The home screen shows more than just today by default, and the user can pick an explicit date range — replacing the disliked *show older* toggle.
- **How it works:**
  - On load, the home list shows the default window (settled in 40-P), not just today's notes.
  - A date-range control (presets and/or a custom from–to) narrows the list; an "All" option shows everything.
  - The chosen range lives in the URL, so Back from a note, reload, and sharing all restore the same view.
  - Tags and date range apply together. The old *show older* toggle is gone.
- **Scenarios (GWT):** _(provisional — finalised by the prototype)_
  - Given I load the home screen with no filter, then I see the default window of notes, not only today's.
  - Given the home list, when I pick a preset (e.g. Last 30 days), then only notes whose date falls in that range show.
  - Given the home list, when I set a custom from–to range, then only notes in that range show; "All" shows every loaded note.
  - Given a date range is set, when I open a note and press Save/Back, then the home list restores the same range.
  - Given a date range that matches no notes, then a clear empty state is shown.
  - Given a tag filter and a date range, then both apply together.
  - Given the old *show older* toggle, then it no longer exists and the today-only default no longer applies.

### Slice 40-B — Sort control (scale)

- **User value:** Order the home list the way the user wants — newest/oldest first, or by title.
- **How it works:**
  - An explicit sort control sets the order; the default is settled in 40-P.
  - Sort by date (ascending / descending) or by title (A–Z / Z–A).
  - The chosen sort lives in the URL and restores on return; it composes with the date range and tags.
- **Scenarios (GWT):** _(provisional — finalised by the prototype)_
  - Given the home list, when I sort by date descending, then the newest note is first.
  - Given the home list, when I sort by date ascending, then the oldest note is first.
  - Given the home list, when I sort by title A–Z (or Z–A), then notes order case-insensitively by title.
  - Given I chose a sort, when I open a note and return, then the same sort is restored.
  - Given a sort, a date range, and tags, then all compose (filter then sort).

---

## Build notes _(implementation — skip when reviewing)_

### Scope & constraints
- **Frontend-only, client-side over the already-loaded `cards` set.** The home list already loads the full card set (`useNoteCards()` → `GET /notes/cards`) and filters/sorts in the browser (`ListView.tsx`); default-window, date-range, and sort are all client-side. No new event, command, projection, endpoint, or CDK change.
- **Out of scope:** server-side date/sort over a *paginated* set — that is the separate ["Scalable note loading (pagination) + server-side filtering"](../future-features.md) future-feature; this phase must not pre-empt it.
- **Filter + sort state in URL params**, extending the existing `?q=&tag=&mode=` scheme (CHANGE-23): replace `?older=1` with date-range param(s) (e.g. `?from=&to=` or `?range=`) and a `?sort=` param. Back/reload/share restore the exact view for free.
- **`show older` (CHANGE-19) and today-only default (CHANGE-3) are removed**, not kept in parallel — including CHANGE-19's auto-enable-on-tag-filter.
- The save-button "return to where I came from" is **not** in scope — the existing `navigate(-1)` + URL-persisted filters already cover it.

### 40-A
- `ListView.tsx` default-visibility logic replaced: the today-only + `showOlder` branch (~lines 162–181) gives way to the default-window + date-range filter over `effectiveDate(card)`.
- Date-range state read/written via URL params (extend `writeFilters`); `?older=1` removed; CHANGE-19 auto-enable-on-tag-filter removed.
- Date math reuses `src/dates.ts` (`effectiveDate`, `localTodayISO`) — compare `YYYY-MM-DD` strings; no UTC drift; no hardcoded absolute dates (time-bomb guardrail).
- Tests: vitest/RTL for default window, each preset, custom range, "All", empty state, tag+range compose, URL restore. Run `npm run lint`.
- Browser.E2E (if a journey is warranted): a filtered home list survives a note open→Save→Back via the **gated** home-card path, not ungated search (CHANGE-23 deploy-#633 lesson).

### 40-B
- `ListView.tsx` sort parameterised: the fixed reverse-chronological sort (~lines 171–180) becomes driven by a `?sort=` URL param (default settled in 40-P).
- Sort control keyboard-accessible (real control; satisfies the jsx-a11y gate).
- Tests: vitest/RTL for each sort key+direction, default, compose-with-filter, URL restore. Run `npm run lint`.

### Decisions locked (2026-06-26)
- New numbered phase, prototype-gated (user).
- Frontend-only, client-side over the loaded `cards` set; server-side/paginated filtering stays the separate future-feature.
- Filter + sort state in URL params (extends CHANGE-23).
- `show older` (CHANGE-19) + today-only default (CHANGE-3) superseded and removed.
- Save-button "return to origin" dropped from scope.

### Observability
Frontend-only, client-side filtering/sorting over data already loaded — no new backend call, table, or external dependency, so **no new silent backend failure mode and no new instrumentation** (flagged, not added):
- **Primary silent failure — a filter/sort bug hides notes the user expects to see** (off-by-one date compare, timezone drift, bad sort key). Guarded by the vitest/RTL acceptance tests, not by telemetry.
- **JS errors in the new controls** are already captured by the existing CloudWatch RUM frontend error pipeline (Phase 12-F/12-H) — no new wiring.
- **No new metric or alarm** — the slice adds no resource, endpoint, or external call.

### Deploy-time impact
**Neutral.** No CI workflow, CDK, alias/traffic-shifting, build-step, backend, projection, or event change. Pure `web/` change shipped through the existing frontend deploy job.

### Learning surface
Small, contained frontend feature; the interest is a UX-uncertain redesign settled by a throwaway prototype before implementation, and keeping a richer client-side filter/sort pipeline URL-addressable (read-your-origin restore is free) while honouring the client-side-vs-server-side boundary against the pagination future-feature.
