# Phase 40 — Home notes: richer default, date-range filter, and sort _(Not Started — prototype-gated)_

**Goal:** Replace the home-screen notes model the user dislikes — "today's notes only, plus an opt-in *show older* toggle" — with a richer, explicit browsing experience: **show more notes by default**, filter by an explicit **date range**, and **sort** the list (by date and title, both directions). The disliked *show older* toggle (CHANGE-19) and today-only default (CHANGE-3) are retired and replaced by the date-range filter's default window. **Frontend-only:** the home card list already loads the full card set client-side (`useNoteCards()` → `GET /notes/cards`) and filters/sorts in the browser (`ListView.tsx`), so default-window, date-range, and sort are all **client-side over the already-loaded set** — **no new event, command, projection, endpoint, or CDK change → deploy-time neutral.** Server-side date/sort over a *paginated* set is explicitly **out of scope** — that is the separate ["Scalable note loading (pagination) + server-side filtering"](../future-features.md) future-feature, and this phase must not pre-empt it. **UX is uncertain, so this phase is prototype-gated:** a throwaway frontend prototype settles the default window, the date-range control shape, and the sort control before any real implementation.

## Summary

| Slice | Summary | Status | Depends on |
|-------|---------|--------|------------|
| 40-P | **Prototype (throwaway).** Validate the redesigned home notes list: what "show more by default" means (rolling N-day window / last-N-notes / all), the date-range control shape (presets vs custom from–to vs both), the sort control (by date & title, asc/desc), and how *show older* + today-only default are retired. Settles open questions; no backend, no specs. | Not Started | — |
| 40-A | **New default + date-range filter (keystone).** Retire the *show older* toggle and today-only default; show the prototype-settled default window; add the date-range filter (presets and/or custom from–to). Client-side over the loaded `cards` set; filter state in URL params (extends CHANGE-23) so Back/reload/share restore it. | Not Started | 40-P |
| 40-B | **Sort control (scale).** Sort the home list by date and by title, ascending and descending, via an explicit control; default sort settled in the prototype. Same client-side pipeline + URL param. | Not Started | 40-A |

> **40-A is the keystone** — it removes the mechanism the user dislikes and proves the redesigned client-side filter pipeline (default window + date range + URL persistence) end-to-end. **40-B layers sort on the proven pipeline.** Ship 40-A first; branch 40-B only after 40-A deploys green.

**Open questions for the prototype to settle (40-P):**
1. **Default window — "show more" meaning.** Rolling last-N-days (e.g. 7 / 14 / 30), last-N-notes regardless of date, or all-with-client-paging. (User: *decide in prototype*.)
2. **Date-range control shape.** Quick presets (Today / Last 7 days / Last 30 days / This month / All), an explicit custom from–to picker, or both. Whether "All" stays a one-click escape hatch.
3. **Sort control.** Which keys (date, title), default direction, and where the control sits relative to the filter/search bar.
4. **Retiring *show older*.** Confirm the toggle and the CHANGE-19 auto-enable-on-tag-filter behaviour are fully removed (not left alongside the new model).
5. **Interaction with search + tags.** Sort/date-range apply to the browse list; in active search the relevance ranking still wins (confirm date-range still narrows search results or not). Tags + date-range + sort compose.
6. **Empty-state copy** when a date range or tag filter yields no notes.

**Decisions locked at scoping (2026-06-26):**
- **New numbered phase**, prototype-gated (user, 2026-06-26).
- **Frontend-only, client-side over the loaded `cards` set.** No `GET /notes/cards` change, no new endpoint, no projection, no event, no CDK. Server-side/paginated filtering stays the separate future-feature.
- **Filter + sort state lives in URL params**, extending the existing `?q=&tag=&mode=` scheme (CHANGE-23) — so browser Back from a note, reload, and share all restore the exact filtered+sorted view for free. Replace `?older=1` with the new date-range param(s) (e.g. `?from=&to=` or `?range=`) and a `?sort=` param.
- **`show older` (CHANGE-19) and today-only default (CHANGE-3) are superseded and removed**, not kept in parallel.
- **The save-button "return to where I came from" is explicitly NOT part of this phase** — the user confirmed the current `navigate(-1)` + URL-persisted filters already do this; dropped from scope.

**Learning surface:** small, contained frontend feature; the interest is a UX-uncertain redesign settled by a throwaway prototype before implementation, and keeping a richer client-side filter/sort pipeline URL-addressable (so read-your-origin restore is free) while honouring the client-side-vs-server-side boundary against the pagination future-feature.

---

## Slices

### Slice 40-P — Prototype (throwaway, frontend-only)

**Purpose:** Settle the six open questions above before any spec or real code. Run the `prototype` skill on a `prototype/home-notes-browse` branch/worktree; quick-and-dirty scaffolding over mock cards, never merged. On approval, the exit procedure rewrites the 40-A / 40-B GWT scenarios + locked UX in this doc; real implementation starts from the updated doc, not prototype code.

**Validate:** the default window, the date-range control shape, the sort control, the empty states, and the retirement of *show older* — on realistic card volumes (today's notes, a month of notes, a year of notes).

### Slice 40-A — New default + date-range filter (keystone; depends on 40-P)

**User value:** The home screen shows more than just today by default, and the user can pick an explicit date range — replacing the disliked *show older* toggle.

**Scenarios (GWT):** _(finalised by the prototype; provisional)_
- Given I load the home screen, when no filter is set, then I see the default window of notes (settled in 40-P), not only today's.
- Given the home list, when I pick a date-range preset (e.g. Last 30 days), then only notes whose effective date falls in that range are shown.
- Given the home list, when I set a custom from–to range, then only notes in that range are shown; an "All" escape hatch shows every loaded note.
- Given I have set a date range, when I open a note and press Save/Back, then the home list restores the same range (URL-persisted; via existing `navigate(-1)`).
- Given a date range that matches no notes, then a clear empty state is shown.
- Given a tag filter and a date range, then both apply together (compose).
- Given the old `show older` toggle, then it no longer exists and the today-only default no longer applies.

**Acceptance criteria:** _(finalised by the prototype)_
- `ListView.tsx` default-visibility logic replaced: the today-only + `showOlder` branch (lines ~162–181) gives way to the default-window + date-range filter over `effectiveDate(card)`.
- Date-range state read/written via URL params (extend `writeFilters`); `?older=1` removed; CHANGE-19 auto-enable-on-tag-filter removed.
- Date math reuses the local-date discipline in `src/dates.ts` (`effectiveDate`, `localTodayISO`) — compare `YYYY-MM-DD` strings; no UTC drift; no hardcoded absolute dates (time-bomb guardrail).
- Frontend tests: vitest/RTL for default window, each preset, custom range, "All", empty state, tag+range compose, and URL restore. Run `npm run lint`.
- Browser.E2E (if a journey is warranted): a filtered home list survives a note open→Save→Back (reuse the gated home-card path, **not** ungated search — cf. CHANGE-23 deploy-#633 lesson).

### Slice 40-B — Sort control (scale; depends on 40-A)

**User value:** Order the home list the way the user wants — newest/oldest first, or by title.

**Scenarios (GWT):** _(finalised by the prototype; provisional)_
- Given the home list, when I sort by date descending, then the newest-effective-date note is first (today's current default order).
- Given the home list, when I sort by date ascending, then the oldest note is first.
- Given the home list, when I sort by title A–Z (or Z–A), then notes order case-insensitively by title.
- Given I chose a sort, when I open a note and return, then the same sort is restored (URL param).
- Given a sort and a date range and tags, then all compose (filter then sort).

**Acceptance criteria:** _(finalised by the prototype)_
- `ListView.tsx` sort replaced/parameterised: the fixed reverse-chronological sort (lines ~171–180) becomes driven by a `?sort=` URL param (default settled in 40-P).
- Sort control is keyboard-accessible (real control, satisfies the jsx-a11y gate).
- Frontend tests: vitest/RTL for each sort key+direction, default, and compose-with-filter; URL restore. Run `npm run lint`.

---

## Observability

Frontend-only, client-side filtering/sorting over data already loaded — no new backend call, table, or external dependency, so there is **no new silent backend failure mode and no new instrumentation warranted** (flagged, not added):

- **Primary silent failure — a filter/sort bug hides notes the user expects to see** (an off-by-one date comparison, a timezone drift, a bad sort key). Guarded by the vitest/RTL acceptance tests (each preset, custom range, empty state, each sort key), **not** by telemetry.
- **JS errors in the new controls** are already captured by the existing CloudWatch RUM frontend error pipeline (Phase 12-F/12-H) — no new wiring.
- **No new metric or alarm** — the slice adds no resource, endpoint, or external call.

## Deploy-time impact

**Neutral.** No CI workflow, CDK, alias/traffic-shifting, build-step, backend, projection, or event change. Pure `web/` change shipped through the existing frontend deploy job.
