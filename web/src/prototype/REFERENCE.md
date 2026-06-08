# Search bar — prototype reference (Phase 22, slice 22-B)

Throwaway prototype on `prototype/22-search-bar`. Never merged. The real 22-B is
rebuilt from scratch in `web/src/` using this file + the `phase-22.md` GWTs as the brief.

## Confirmed UX

**Results layout: CARDS.** The existing home note-card grid is filtered down to the
matches **in place** — the same card component, same grid. The two alternatives shown
in the prototype were **rejected**:
- ❌ Dense list (title + matched snippet rows) — too different from the home screen.
- ❌ Floating dropdown overlay — unnecessary new interaction pattern.

**Search bar placement.** Full-width input directly above the filters + card grid on
the home screen. Leading magnifier icon; a clear (`✕`) button appears only when there
is a query.

**As-you-type, debounced.** ~300 ms debounce felt right (prototype used 250 ms + jitter).
No submit button, no Enter required.

**Result count.** Header shows `N match(es)` while a search is active, replacing the
normal `N notes` count.

**Three distinct states (all confirmed needed):**
- **Loading** — brief "Searching…" with a spinner after the debounce settles.
- **No matches** — explicit empty message (`No notes match "<q>"`), neutral styling.
- **Error** — visually **distinct** from no-matches: red/error styling + a **Retry**
  action. A failed fetch must never render as "no matches". (This distinction was the
  main reason to prototype the states.)

**Filter precedence — search SUSPENDS filters.** While a query is present, the tag/
folder/date filters are paused (chips greyed + a "Filters paused while searching" hint).
Clearing the search restores the **prior** filtered view exactly as it was. Search does
not compose with filters; it takes over the grid.

**Out-of-order guard.** As-you-type fires overlapping requests; only the latest query's
response may render. Prototype used a monotonic `reqId` ref and discarded stale responses.

**Result card content.** Same fields as a normal card (title, date, tags, to-do count)
but the preview line shows the **matched snippet** (the body region around the hit) rather
than the static first-N-chars preview. Highlighting the matched substring is a nice-to-have,
not required.

## Implied API shape (built in 22-A)

`GET /notes/search?q=<query>` → ranked array:
```
[{ noteId, title, snippet, score, matchedField,   // matchedField ∈ title|tag|notes
   date, folder, tags[], openActions }]
```
The card needs the same display fields a normal card carries, plus `snippet` + `matchedField`.
Empty/whitespace `q` → empty array (client also short-circuits and shows the normal view).

## Component / state decisions

- **Reuse the existing card + grid component** — do not build a new results component.
- Search state (query, phase, results) lives at the **home/App level**, where `cards`
  already live — the same place the filter state lives, so suspending filters is local.
- **No `localStorage`** — search query is transient, not persisted across reloads.
- The fake fuzzy/Levenshtein in `PrototypeRoot.tsx` is mock-only; real fuzzy ranking is
  server-side in 22-A (FuzzySharp / token-set). The frontend just renders ranked results.

## localStorage keys

None.
