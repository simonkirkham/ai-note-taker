# Phase 22 — Search across notes

**Goal:** Today the only way to find a note is to scroll the home grid or narrow it by tag/folder/date — there is no free-text search. This phase adds **fuzzy search across all of a user's notes** from a home-screen search bar. Deliberately **no new infrastructure and no fixed cost**: a new `NoteSearchView` projection holds one searchable document per note, and a `GET /notes/search?q=` endpoint reads the current user's documents and **fuzzy-ranks them in-Lambda** (Levenshtein / token-set ratio), returning the best matches. This keeps search inside the existing DynamoDB + Lambda stack at $0 marginal cost, and the read model is disposable (rebuildable from the event stream) like every other projection. Search covers **title, Quick notes (user body), Final notes (summary / discussion / decisions), tags, and action-item text** — but **not** the raw transcript (long, noisy, would swamp results). Sliced backend-first: **22-A** builds the searchable read model + the fuzzy endpoint (independently shippable, API-testable); **22-B** adds the home search bar. 22-B depends on 22-A.

**Learning surface:** a purpose-built read model shaped for a query rather than a screen; doing search *without* a search engine — in-process fuzzy ranking over a `UserId`-scoped projection read, and where that approach's cost/latency curve bends (linear in note count, fine at personal scale, superseded later by the planned pagination/server-side-filter feature); ranking/threshold tuning as a measurable concern; and the privacy discipline of never logging query text or note content.

## Summary

| Slice | Summary | Status | Depends on |
|-------|---------|--------|------------|
| 22-A | **Searchable read model + fuzzy search endpoint.** New `NoteSearchView` projection (one doc per note: title, body, final-notes text, tags, action-item text, `UserId`), wired inline in every handler that changes a searchable field, plus a rebuild backfill. New `GET /notes/search?q=` reads the user's docs and fuzzy-ranks in-Lambda, returning ranked results scoped to the user. No UI — independently shippable. | Not Started | — |
| 22-B | **Home search bar.** A debounced, as-you-type search box on the home screen; results replace the card grid; composes with the existing tag/folder/date filters; explicit no-results and error states distinct from each other; clearing restores the normal view; out-of-order responses discarded (latest query wins). | Not Started | 22-A |

> 22-A is a backend-only vertical slice (a working search API, no screen) and ships on its own. 22-B is the user-facing half and depends on 22-A. Both build on the projection-rebuild infrastructure and on Phase 15 (Final-notes content) and Phase 3/11 (action-item text). A throwaway frontend prototype of the search bar precedes 22-B; its confirmed GWT/UX rewrites the 22-B section here on exit.

---

## Slice 22-A — Searchable read model + fuzzy search endpoint

**Status:** Not Started

**User value:** None directly visible (no UI) — delivers a working, user-scoped fuzzy search API that 22-B renders. Proof is the endpoint's integration specs, not a screen.

### How it works (implementation notes)

- **New `NoteSearchView` projection**, one document per note: `NoteId` (PK), `UserId` (GSI partition key so the endpoint queries a user's notes directly), `Title`, `Body` (Quick notes / `ContentEditedV2`), `FinalNotesText` (concatenated `Summary` + `DiscussionPoints` + `Decisions` from `AnalysisSummaryRecorded`), `Tags[]`, `ActionItemsText` (concatenated open + done action descriptions), `Deleted`. **No transcript.**
- **Wired inline** (per the projections-update-inline rule) in every handler that mutates a searchable field: `NoteCommandHandler` (create, rename, content edit, analysis-summary, tag add/remove) and `ActionItemCommandHandler` (add / edit / complete / reopen / delete). Plus the `ProjectionRebuildHandler` backfill path — never as a separate event-handler class.
- **`GET /notes/search?q=`**: query the caller's `NoteSearchView` docs via the `UserId` GSI, exclude `Deleted`, then **fuzzy-rank in-Lambda** (e.g. `FuzzySharp` token-set / partial ratio — Breaker/Pip confirm the library). Score each note as the **max** field score with **title weighted highest**; drop notes below a relevance threshold; sort by score desc; cap to top N. Return `noteId`, `title`, a short snippet/preview, and `score`.

### Scenarios

**Fuzzy match tolerates a typo**
- Given a note whose body contains "planning"
- When the user searches `planing`
- Then the note is returned

**Match on the Quick-notes body**
- Given a note whose body mentions "budget review"
- When the user searches `budget`
- Then the note is returned

**Match on Final-notes text**
- Given a note whose AI summary/decisions mention "migration"
- When the user searches `migration`
- Then the note is returned

**Match on a tag**
- Given a note tagged `roadmap`
- When the user searches `roadmap`
- Then the note is returned

**Match on action-item text**
- Given a note with an action item "email the vendor"
- When the user searches `vendor`
- Then the note is returned

**Transcript text is not searched**
- Given a note whose only occurrence of "quarterly" is in the raw transcript
- When the user searches `quarterly`
- Then the note is not returned

**Results are ranked with title weighted highest**
- Given one note with the term in its title and another with it only in the body
- When the user searches that term
- Then both are returned and the title match ranks first

**Below-threshold query returns nothing, not everything**
- Given notes with no term resembling the query
- When the user searches an unrelated term
- Then an empty result list is returned (never the full note set)

**Results are scoped to the current user**
- Given two users each with notes matching `report`
- When user A searches `report`
- Then only user A's notes are returned

**Deleted notes are excluded**
- Given a deleted note that would otherwise match
- When the user searches a matching term
- Then it is not returned

**A note becomes searchable after an edit (inline projection update)**
- Given a new note edited to contain "invoice"
- When the user searches `invoice`
- Then the note is returned without a rebuild

**Rebuild backfills the searchable model**
- Given existing notes created before this slice
- When the projection is rebuilt
- Then searching their terms returns them

**Blank query is rejected cleanly**
- Given any notes
- When the search query is empty or whitespace
- Then the endpoint returns an empty result (or `400`) — not the full set, not a 500

### Acceptance criteria

1. `NoteSearchView` stores the searchable fields above per note with `UserId`; an integration test asserts the document is written and updated when each owning event is appended.
2. The projection is updated **inline** in every owning command handler (Note + ActionItem) and rebuilt by `ProjectionRebuildHandler`; no separate event-handler class is introduced.
3. `GET /notes/search?q=` returns user-scoped, fuzzy-ranked results with the matched note's `noteId`, `title`, snippet, and `score`; title matches outrank body-only matches.
4. Typo-tolerant matching works (`planing`→`planning`); below-threshold queries return empty, not the full set.
5. Raw transcript text is **not** matched; tags and action-item text **are**.
6. Cross-user isolation is asserted by an `Api.Integration` scenario (user A never sees user B's notes).
7. Deleted notes are excluded; the rebuild backfills every existing note; `cdk synth` green (new table + GSI + Lambda env var + IAM grant).
8. The request/response contract carries no field the handler does not read (contract-honesty guardrail).

---

## Slice 22-B — Home search bar

**Status:** Not Started

**User value:** Find any note by typing a few characters — including with a typo — without scrolling or filtering by tag/folder.

> **Prototype done** (`prototype/22-search-bar`, see `web/src/prototype/REFERENCE.md`). Confirmed UX below; **Cards** layout chosen over a dense results list and a floating dropdown (both rejected).

### How it works (implementation notes — confirmed by prototype)

- **Results layout: cards.** Reuse the **existing home note-card grid**, filtered to the matches **in place** — same card component, same grid. No new results component, no dense list, no dropdown overlay.
- A full-width search input on the home screen **above** the filters/grid (magnifier icon; clear `✕` shown only when a query is present); input is **debounced (~300 ms)** and calls `GET /notes/search?q=`; matching cards **replace the grid** while a query is active. As-you-type — no submit/Enter.
- The header shows `N match(es)` while searching, replacing the normal `N notes` count.
- Search is a **read**, so there is no optimistic mutation — but it needs three **distinct** states: **loading** ("Searching…"), an explicit **no-matches** empty state, and an **error** state that is **visually distinct** from no-matches (error styling + Retry). A failed fetch must never render as "no matches".
- **Result card** shows the same fields as a normal card (title, date, tags, to-do count) but its preview line shows the **matched snippet** (body region around the hit) instead of the static preview; highlighting the matched substring is a nice-to-have.
- **Out-of-order guard:** as-you-type fires overlapping requests; only the latest query's response may render (monotonic `reqId` / ignore-stale-response — see the effect-hygiene guardrail).
- **Filter precedence — search suspends filters.** While a query is present the tag/folder/date filters are **paused** (greyed, with a "Filters paused while searching" hint); search takes over the grid and does not compose with them. Clearing the box restores the **prior** filtered view exactly. Search state lives at the home/App level alongside the existing `cards` + filter state.

### Scenarios

**Typing shows matching notes as cards**
- Given notes that match `budget`
- When the user types `budget` into the search box
- Then the card grid is replaced by the matching notes' cards and the header shows the match count

**Search is debounced**
- Given the user types several characters quickly
- When the input settles
- Then one search request is issued, not one per keystroke

**An active search suspends the filters**
- Given a tag/folder filter is active
- When the user has a query entered
- Then the tag/folder/date filters are paused (not applied) and indicated as paused

**Clearing the box restores the prior filtered view**
- Given an active search over a previously tag-filtered view
- When the user clears the input
- Then the prior tag/folder/date-filtered card view returns exactly as before

**No matches shows an explicit empty state**
- Given a query that matches nothing
- When the search completes
- Then a "no matching notes" message is shown — distinct from an error

**A failed search shows an error, not an empty result**
- Given the search request fails
- When the user has a query entered
- Then an error/retry state is shown, never a false "no matching notes"

**Stale responses are discarded**
- Given two searches issued in quick succession
- When the earlier response arrives after the later one
- Then the later query's results remain shown

**Opening a result**
- Given search results are shown
- When the user clicks a result
- Then that note opens

### Acceptance criteria

1. A debounced (~300 ms) as-you-type search box above the home filters/grid drives `GET /notes/search?q=`; the **existing note cards** are filtered to the matches in place while a query is active; the header shows the match count.
2. Three **visually distinct** states are rendered: loading, no-matches, and error with Retry (a failed fetch is never shown as "no matches").
3. Out-of-order responses are discarded — the latest query wins (ignore-stale-response guard).
4. An active search **suspends** the tag/folder/date filters (paused + indicated); clearing the query restores the prior filtered view exactly.
5. Result cards show the matched snippet; selecting a card opens the note.
6. Covered by component tests (RTL + MSW) for each state and the stale-response guard; role/label queries, `userEvent` (test-quality guardrails).

---

## Observability

Search fails **silently** in two ways that both look like "no notes" to the user, so the failure modes must be distinguishable in telemetry and UI.

1. **Searchable-model drift (highest risk).** If `NoteSearchView` is not updated when content, tags, or action items change, a note silently stops matching — looking like "no results" rather than a bug. Guard: the inline wiring in *every* owning handler is the fix; assert it with `Api.Integration` scenarios that append each owning event then search (22-A). A `NoteSearchView` rebuild must reconverge — covered by the rebuild scenario.
2. **Threshold mis-tune → always-empty search.** A relevance threshold set too high makes every query return nothing while the endpoint reports 200 — invisible. Emit an EMF metric `SearchPerformed` with **`resultCount`** and watch the **zero-result rate**; a sustained 100% zero-result rate is the signal. Fold the metric into 22-A.
3. **Latency growth with note count.** In-Lambda ranking is linear in the user's note count; as it grows, search latency climbs silently. Emit `notesScanned` + search latency on `SearchPerformed`; this is the quantified trigger to graduate to the pagination/server-side-filter feature. Alarm-worthy if P99 latency crosses the user-facing budget.
4. **Cross-user leakage.** A bug in the `UserId` filter would return another user's notes — a silent security failure, not a visible error. This is logic, not telemetry: guard with the 22-A isolation `Api.Integration` scenario.
5. **Frontend: failed search rendered as empty.** A swallowed fetch error shown as "no matching notes" hides a real outage. Guard: the explicit error state (22-B AC #2) + a component test; surface search request failures to RUM like other failed API calls.

**Privacy:** never log the **raw query text** or **note content** — meeting notes are sensitive (the same reason the data stays in AWS). Log query **length** + `resultCount` + latency only; metrics carry no free text.

Run the `observability-brief` output into 22-A's acceptance criteria when Breaker drafts the spec: the `SearchPerformed` metric (`resultCount`, `notesScanned`, latency) and the no-free-text logging rule are backend work in 22-A; the error-state assertion is a 22-B component test.
