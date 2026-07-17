import clsx from "clsx";
import { Fragment, useDeferredValue, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { NoteCard as NoteCardData, SearchResult } from "../api/notes";
import { effectiveDate, localDateISO } from "../dates";
import { type SearchState, useNoteSearch } from "../hooks/useNoteSearch";
import { useTags } from "../hooks/useTags";
import styles from "./ListView.module.css";
import MeetingsSection from "./MeetingsSection";
import NoteCard from "./NoteCard";
import SearchBar from "./SearchBar";
import TagFilter from "./TagFilter";
import TodoSection from "./TodoSection";

// Join a ranked search result to its already-loaded card so the full NoteCard
// renders, but with the matched snippet as the preview. Falls back to a minimal
// card when the result's note isn't in the loaded set (edge case).
function resultToCard(
  result: SearchResult,
  byId: Map<string, NoteCardData>,
): NoteCardData {
  const card = byId.get(result.noteId);
  if (card) return { ...card, contentPreview: result.snippet };
  return {
    noteId: result.noteId,
    title: result.title,
    contentPreview: result.snippet,
    date: null,
    openActions: [],
    createdAt: "",
    lastModifiedAt: "",
    tags: [],
    folderId: null,
  };
}

// Phase 40-A: the home list shows a rolling default window (the last 30 days)
// instead of today-only, with an explicit date-range control that replaces the
// retired "show older" toggle (CHANGE-3/CHANGE-19). A preset id in the URL
// `?range=` (or a `?from=&to=` pair) overrides the default; nothing in the URL
// means the default window. All client-side over the already-loaded cards.
type RangePreset = "today" | "7" | "30" | "month" | "all";

const RANGE_PRESETS: { id: RangePreset; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "7", label: "Last 7 days" },
  { id: "30", label: "Last 30 days" },
  { id: "month", label: "This month" },
  { id: "all", label: "All" },
];

const DEFAULT_RANGE: RangePreset = "30";

// Phase 40-B: an explicit sort control over the home list, persisted in `?sort=`.
// Newest-first is the default, so it is never written to the URL.
type SortKey = "date-desc" | "date-asc" | "title-asc" | "title-desc";

const SORT_OPTIONS: { id: SortKey; label: string }[] = [
  { id: "date-desc", label: "Newest first" },
  { id: "date-asc", label: "Oldest first" },
  { id: "title-asc", label: "Title A–Z" },
  { id: "title-desc", label: "Title Z–A" },
];

const DEFAULT_SORT: SortKey = "date-desc";

// When the list is sorted by date and spans a wide window, group cards under
// month headers (40-B). Short or title-sorted views stay a flat grid.
const MONTH_GROUP_SPAN_DAYS = 45;

// "2026-07" → "July 2026".
function monthLabel(yyyyMm: string): string {
  const [y, m] = yyyyMm.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });
}

// N days before `today` as a local YYYY-MM-DD string (0 = today).
function daysAgoISO(n: number, today: Date = new Date()): string {
  const d = new Date(today);
  d.setDate(d.getDate() - n);
  return localDateISO(d);
}

// First calendar day of the current local month, YYYY-MM-DD.
function firstOfMonthISO(today: Date = new Date()): string {
  return localDateISO(new Date(today.getFullYear(), today.getMonth(), 1));
}

// Inclusive [lo, hi] date bounds for a preset; "" means unbounded on that side.
// A single `now` anchors every bound so all sides agree on "today".
function presetBounds(preset: RangePreset): { lo: string; hi: string } {
  const now = new Date();
  const today = localDateISO(now);
  switch (preset) {
    case "today":
      return { lo: today, hi: today };
    case "7":
      return { lo: daysAgoISO(6, now), hi: today };
    case "month":
      return { lo: firstOfMonthISO(now), hi: today };
    case "all":
      return { lo: "", hi: "" };
    case "30":
    default:
      return { lo: daysAgoISO(29, now), hi: today };
  }
}

export default function ListView({
  cards,
  loading,
  creating,
  createError,
  onNewNote,
  onEditNote,
  onOpenNote,
  onDeleteNote,
  folderPath,
  currentFolderId,
  onHome,
  otherWorkspaces,
  onMoveNoteToWorkspace,
}: {
  cards: NoteCardData[];
  loading: boolean;
  creating: boolean;
  createError: string | null;
  onNewNote: () => void;
  onEditNote: (noteId: string) => void;
  onOpenNote: (noteId: string, title?: string, isNew?: boolean) => void;
  onDeleteNote?: (noteId: string) => void;
  folderPath?: string[];
  currentFolderId?: string;
  onHome?: () => void;
  otherWorkspaces?: { workspaceId: string; name: string }[];
  onMoveNoteToWorkspace?: (noteId: string, workspaceId: string) => void;
}) {
  const { data: tagEntries = [] } = useTags();
  // CHANGE-23 + 40-A: every home-list filter lives in the URL query string, so
  // opening a note (a push navigation) and pressing Back restores the URL — and
  // with it the populated filters. All filters (query, tags, mode, date range)
  // are derived from `searchParams` and every setter writes them back with
  // `replace: true`, so typing/filtering does not spam the history stack (only
  // opening a note pushes). Filters are per-view:
  // the App navigation handlers route to bare paths (no query string), so
  // switching folder or going Home intentionally clears them — Back still restores
  // them because it replays the prior history entry, query string included.
  const [searchParams, setSearchParams] = useSearchParams();
  const query = searchParams.get("q") ?? "";
  // Memoized so it keeps a stable identity across renders (a fresh `getAll`
  // array each render breaks the downstream `filteredCards` memo — the compiler
  // can't preserve a memo whose dependency is recreated every render).
  const selectedTags = useMemo(() => searchParams.getAll("tag"), [searchParams]);
  const filterMode: "AND" | "OR" = searchParams.get("mode") === "OR" ? "OR" : "AND";
  // Date range (40-A). A custom `?from=&to=` pair takes precedence; otherwise a
  // `?range=` preset id; otherwise the default window (last 30 days). "Last 30
  // days" is the default, so selecting it clears the param rather than pinning
  // range=30 in the URL — default and range=30 are the same window.
  const rangeFrom = searchParams.get("from") ?? "";
  const rangeTo = searchParams.get("to") ?? "";
  const isCustomRange = rangeFrom !== "" || rangeTo !== "";
  const rangeParam = searchParams.get("range");
  const activePreset: RangePreset = RANGE_PRESETS.some((p) => p.id === rangeParam)
    ? (rangeParam as RangePreset)
    : DEFAULT_RANGE;
  // Sort order (40-B); newest-first is the default (absence of the param).
  const sortParam = searchParams.get("sort");
  const activeSort: SortKey = SORT_OPTIONS.some((o) => o.id === sortParam)
    ? (sortParam as SortKey)
    : DEFAULT_SORT;
  const isDefaultRange = !isCustomRange && (rangeParam === null || rangeParam === DEFAULT_RANGE);
  const [filtersOpen, setFiltersOpen] = useState(false);
  // Whether the custom from–to inputs are revealed. The user opens them via
  // "Custom…" before entering dates; they are also implicitly open whenever a
  // custom range is present in the URL (e.g. restored by Back without a remount).
  const [customOpen, setCustomOpen] = useState(isCustomRange);
  const customActive = customOpen || isCustomRange;

  // Write a partial filter update back to the URL, preserving any unrelated
  // params. Keys absent from `next` keep their current value; a key present with
  // a falsy value clears it. `replace` avoids a history entry per keystroke/toggle.
  function writeFilters(next: {
    query?: string;
    tags?: string[];
    mode?: "AND" | "OR";
    range?: RangePreset | null;
    from?: string | null;
    to?: string | null;
    sort?: SortKey;
  }) {
    const params = new URLSearchParams(searchParams);
    const q = next.query ?? query;
    if (q) params.set("q", q);
    else params.delete("q");
    const tags = next.tags ?? selectedTags;
    params.delete("tag");
    tags.forEach((t) => params.append("tag", t));
    const mode = next.mode ?? filterMode;
    if (mode === "OR") params.set("mode", "OR");
    else params.delete("mode");
    if ("range" in next) {
      // The default window is the absence of a param, so range=30 is never written.
      if (next.range && next.range !== DEFAULT_RANGE) params.set("range", next.range);
      else params.delete("range");
    }
    if ("from" in next) {
      if (next.from) params.set("from", next.from);
      else params.delete("from");
    }
    if ("to" in next) {
      if (next.to) params.set("to", next.to);
      else params.delete("to");
    }
    if ("sort" in next) {
      // Newest-first is the default, so it is never pinned in the URL.
      if (next.sort && next.sort !== DEFAULT_SORT) params.set("sort", next.sort);
      else params.delete("sort");
    }
    setSearchParams(params, { replace: true });
  }

  const setQuery = (value: string) => writeFilters({ query: value });
  const setFilterMode = (mode: "AND" | "OR") => writeFilters({ mode });
  const setSort = (sort: SortKey) => writeFilters({ sort });

  // Picking a preset clears any custom range and closes the custom inputs.
  function selectPreset(preset: RangePreset) {
    setCustomOpen(false);
    writeFilters({ range: preset, from: null, to: null });
  }
  // "Custom…" reveals the from–to inputs and drops any active preset (custom is
  // driven purely by the from/to params).
  function openCustom() {
    setCustomOpen(true);
    writeFilters({ range: null });
  }
  const setFrom = (value: string) => writeFilters({ range: null, from: value || null });
  const setTo = (value: string) => writeFilters({ range: null, to: value || null });

  // The input stays bound to `query` (updates synchronously on every keystroke);
  // the expensive search fetch + list re-derivation run off the deferred copy as
  // a non-urgent update, so typing never blocks on the heavy work (19-I3).
  const deferredQuery = useDeferredValue(query);

  const { state: searchState, retry } = useNoteSearch(deferredQuery);
  const searching = deferredQuery.trim() !== "";

  const cardsById = useMemo(
    () => new Map(cards.map((c) => [c.noteId, c])),
    [cards],
  );

  const searchResults = searchState.status === "results" ? searchState.results : [];

  const availableTags = useMemo(() => tagEntries.map((e) => e.tag), [tagEntries]);

  const filteredCards = useMemo(() => {
    let result = cards;
    if (currentFolderId === "__unfiled__") {
      result = result.filter((c) => !c.folderId);
    } else if (currentFolderId) {
      result = result.filter((c) => c.folderId === currentFolderId);
    }
    if (selectedTags.length === 0) return result;
    // Tags are case-insensitive (CHANGE-17): compare lowercased so a legacy mixed-case
    // card tag still matches the lowercase filter pill before the prod rebuild lands.
    const selected = selectedTags.map((t) => t.toLowerCase());
    return result.filter((c) => {
      const cardTags = (c.tags ?? []).map((t) => t.toLowerCase());
      return filterMode === "AND"
        ? selected.every((t) => cardTags.includes(t))
        : selected.some((t) => cardTags.includes(t));
    });
  }, [cards, selectedTags, filterMode, currentFolderId]);

  // Home note list: notes whose effective date falls inside the active date
  // window — the default rolling last-30-days, a chosen preset, or a custom
  // from–to range (40-A). Sorted reverse-chronologically by effective date, with
  // lastModifiedAt descending as the tiebreaker. The folder view does not use
  // this — it keeps showing all notes via filteredCards.
  const homeCards = useMemo(() => {
    const { lo, hi } = isCustomRange
      ? { lo: rangeFrom, hi: rangeTo }
      : presetBounds(activePreset);
    const visible = filteredCards.filter((c) => {
      const eff = effectiveDate(c);
      if (lo && eff < lo) return false;
      if (hi && eff > hi) return false;
      return true;
    });
    return [...visible].sort((a, b) => {
      if (activeSort === "title-asc" || activeSort === "title-desc") {
        const c = a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
        return activeSort === "title-asc" ? c : -c;
      }
      // Date sort. Compute an ascending comparison (older first), then flip for
      // descending. The lastModifiedAt tiebreak follows the same direction, so
      // it stays a consistent secondary key. Lexicographic string compare is
      // valid because both the backend (DateTimeOffset) and the optimistic card
      // (new Date().toISOString()) emit canonical UTC ISO-8601 (Z-suffixed).
      const ea = effectiveDate(a);
      const eb = effectiveDate(b);
      let c: number;
      if (ea !== eb) c = ea < eb ? -1 : 1;
      else if (a.lastModifiedAt !== b.lastModifiedAt) c = a.lastModifiedAt < b.lastModifiedAt ? -1 : 1;
      else c = 0;
      return activeSort === "date-asc" ? c : -c;
    });
  }, [filteredCards, isCustomRange, rangeFrom, rangeTo, activePreset, activeSort]);

  // Month grouping (40-B): only when sorted by date and the visible span is wide.
  const groupByMonth = useMemo(() => {
    if (!activeSort.startsWith("date") || homeCards.length === 0) return false;
    const first = effectiveDate(homeCards[0]);
    const last = effectiveDate(homeCards[homeCards.length - 1]);
    const spanDays = Math.abs(Date.parse(first) - Date.parse(last)) / 86_400_000;
    return spanDays > MONTH_GROUP_SPAN_DAYS;
  }, [homeCards, activeSort]);

  function toggleTag(tag: string) {
    const next = selectedTags.includes(tag)
      ? selectedTags.filter((t) => t !== tag)
      : [...selectedTags, tag];
    writeFilters({ tags: next });
  }

  function clearFilter() {
    writeFilters({ tags: [], mode: "AND" });
  }

  // Empty-state escape hatch: reset every home filter (query, tags, range) to
  // the default view.
  function clearAllFilters() {
    setCustomOpen(false);
    writeFilters({ query: "", tags: [], mode: "AND", range: null, from: null, to: null });
  }

  const isInFolder = !!currentFolderId;
  const heading = folderPath && folderPath.length > 0 ? folderPath.join(" → ") : "Home";
  // CHANGE-9 (Option D): the collapsed Filters control summarises every active
  // filter — a non-default date range and/or selected tags — e.g.
  // "Filters · Last 7 days · 2 tags". The default 30-day window is the no-filter
  // state, so it is never summarised.
  const tagCount = selectedTags.length;
  const rangeLabel = isCustomRange
    ? "Custom range"
    : (RANGE_PRESETS.find((p) => p.id === activePreset)?.label ?? "");
  const filterSummary = [
    !isDefaultRange ? rangeLabel : null,
    tagCount > 0 ? `${tagCount} ${tagCount === 1 ? "tag" : "tags"}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const showActiveSummary = !filtersOpen && filterSummary.length > 0;
  // Gates the empty-state "Clear filters" button. Deliberately omits `query`:
  // the empty state only renders when `!searching`, so a query is never the
  // reason the home list is empty here.
  const hasActiveFilter = !isDefaultRange || tagCount > 0;

  return (
    <main className="container">
      <div className="header">
        <div className={styles.headerTitleGroup}>
          {folderPath && folderPath.length > 0 && (
            <button className={styles.folderBreadcrumbBack} onClick={onHome}>
              ← All Notes
            </button>
          )}
          <h1 className="title">{heading}</h1>
        </div>
        <button
          className="new-note-button"
          onClick={onNewNote}
          disabled={creating}
        >
          {creating ? "Creating…" : "New Note"}
        </button>
      </div>
      {createError && (
        <p data-testid="create-error" className="error" role="alert">
          {createError}
        </p>
      )}
      {loading && <p role="status">Loading…</p>}
      {isInFolder ? (
        <>
          <TagFilter
            tags={availableTags}
            selectedTags={selectedTags}
            mode={filterMode}
            onToggle={toggleTag}
            onModeChange={setFilterMode}
            onClear={clearFilter}
          />
          {filteredCards.length > 0 && (
            <section className={styles.noteCardsSection}>
              <h2 className={styles.noteCardsHeading}>Notes</h2>
              <div className={styles.noteCards} data-testid="note-cards">
                {filteredCards.map((card) => (
                  <NoteCard
                    key={card.noteId}
                    card={card}
                    onEdit={onEditNote}
                    onDelete={onDeleteNote ? () => onDeleteNote(card.noteId) : undefined}
                    otherWorkspaces={otherWorkspaces}
                    onMoveToWorkspace={onMoveNoteToWorkspace}
                  />
                ))}
              </div>
            </section>
          )}
        </>
      ) : (
        <div className={styles.homeLayout}>
          <div className={styles.homeLeft}>
            <section className={styles.noteCardsSection}>
              <div className={styles.noteCardsHeader}>
                <h2 className={styles.noteCardsHeading}>
                  {searchState.status === "results"
                    ? `${searchState.results.length} ${
                        searchState.results.length === 1 ? "match" : "matches"
                      }`
                    : "Notes"}
                </h2>
                {!searching && (
                  <label className={styles.sortControl}>
                    <span className={styles.sortControlLabel}>Sort</span>
                    <select
                      data-testid="sort-select"
                      aria-label="Sort notes"
                      value={activeSort}
                      onChange={(e) => setSort(e.target.value as SortKey)}
                    >
                      {SORT_OPTIONS.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </div>
              <SearchBar value={query} onChange={setQuery} onClear={() => setQuery("")} />
              <div className={styles.filtersSection}>
                <button
                  type="button"
                  className={clsx(styles.filtersToggle, {
                    [styles.filtersToggleOpen]: filtersOpen && !searching,
                    [styles.filtersToggleActive]: showActiveSummary && !searching,
                  })}
                  aria-expanded={filtersOpen && !searching}
                  aria-controls="home-filters-panel"
                  disabled={searching}
                  onClick={() => setFiltersOpen((open) => !open)}
                >
                  <span className={styles.filtersToggleChevron} aria-hidden="true">
                    ▸
                  </span>
                  <span>
                    Filters
                    {showActiveSummary && !searching && (
                      <span className={styles.filtersToggleSummary}> · {filterSummary}</span>
                    )}
                  </span>
                </button>
                {searching && (
                  <p className={styles.filtersPausedHint} role="status">
                    Filters paused while searching
                  </p>
                )}
                <div
                  id="home-filters-panel"
                  className="filters-panel"
                  hidden={!filtersOpen || searching}
                >
                  {filtersOpen && !searching && (
                    <>
                      <div className={styles.filtersGroup}>
                        <span className={styles.filtersGroupLabel} id="when-filter-label">
                          When
                        </span>
                        <div
                          className={styles.rangePresets}
                          role="group"
                          aria-labelledby="when-filter-label"
                        >
                          {RANGE_PRESETS.map((preset) => (
                            <button
                              key={preset.id}
                              type="button"
                              className={styles.rangePreset}
                              data-testid={`range-preset-${preset.id}`}
                              aria-pressed={!customActive && activePreset === preset.id}
                              onClick={() => selectPreset(preset.id)}
                            >
                              {preset.label}
                            </button>
                          ))}
                          <button
                            type="button"
                            className={styles.rangePreset}
                            data-testid="range-preset-custom"
                            aria-pressed={customActive}
                            onClick={openCustom}
                          >
                            Custom…
                          </button>
                        </div>
                        {customActive && (
                          <div className={styles.customRange}>
                            <label className={styles.customRangeField}>
                              <span>From</span>
                              <input
                                type="date"
                                data-testid="range-from"
                                value={rangeFrom}
                                max={rangeTo || undefined}
                                onChange={(e) => setFrom(e.target.value)}
                              />
                            </label>
                            <label className={styles.customRangeField}>
                              <span>To</span>
                              <input
                                type="date"
                                data-testid="range-to"
                                value={rangeTo}
                                min={rangeFrom || undefined}
                                onChange={(e) => setTo(e.target.value)}
                              />
                            </label>
                          </div>
                        )}
                      </div>
                      <div className={styles.filtersGroup}>
                        <span className={styles.filtersGroupLabel}>Tags</span>
                        <TagFilter
                          tags={availableTags}
                          selectedTags={selectedTags}
                          mode={filterMode}
                          onToggle={toggleTag}
                          onModeChange={setFilterMode}
                          onClear={clearFilter}
                        />
                      </div>
                    </>
                  )}
                </div>
              </div>
              {searching ? (
                // Search results deliberately omit the move-to-workspace control: moving a
                // note out of the active workspace mid-search would make a result vanish under
                // the cursor. Move is available from the (non-search) card list (23-F).
                <SearchResultsArea
                  state={searchState}
                  results={searchResults}
                  cardsById={cardsById}
                  onEditNote={onEditNote}
                  onRetry={retry}
                />
              ) : homeCards.length > 0 ? (
                <div className={styles.noteCards} data-testid="note-cards">
                  {homeCards.map((card, i) => {
                    const month = effectiveDate(card).slice(0, 7);
                    const showHeader =
                      groupByMonth &&
                      (i === 0 || effectiveDate(homeCards[i - 1]).slice(0, 7) !== month);
                    return (
                      <Fragment key={card.noteId}>
                        {showHeader && (
                          <div className={styles.monthHeader} data-testid="month-header">
                            {monthLabel(month)}
                          </div>
                        )}
                        <NoteCard
                          card={card}
                          onEdit={onEditNote}
                          onDelete={onDeleteNote ? () => onDeleteNote(card.noteId) : undefined}
                          otherWorkspaces={otherWorkspaces}
                          onMoveToWorkspace={onMoveNoteToWorkspace}
                        />
                      </Fragment>
                    );
                  })}
                </div>
              ) : (
                <div className={styles.emptyState}>
                  <p className={styles.noteCardsEmpty} role="status">
                    {tagCount > 0
                      ? "No notes match those tags in this range."
                      : !isDefaultRange
                        ? "No notes in this date range."
                        : "No notes here yet."}
                  </p>
                  {hasActiveFilter && (
                    <button
                      type="button"
                      className={styles.clearFiltersButton}
                      onClick={clearAllFilters}
                    >
                      Clear filters
                    </button>
                  )}
                </div>
              )}
            </section>
          </div>
          <aside className={styles.homeRightPanel}>
            <MeetingsSection onOpenNote={onOpenNote} />
            <TodoSection />
          </aside>
        </div>
      )}
    </main>
  );
}

function SearchResultsArea({
  state,
  results,
  cardsById,
  onEditNote,
  onRetry,
}: {
  state: SearchState;
  results: SearchResult[];
  cardsById: Map<string, NoteCardData>;
  onEditNote: (noteId: string) => void;
  onRetry: () => void;
}) {
  if (state.status === "loading") {
    return (
      <p className={styles.searchStatus} role="status">
        Searching…
      </p>
    );
  }
  if (state.status === "error") {
    return (
      <div className={styles.searchError} role="alert">
        <p>Search failed.</p>
        <button type="button" className={styles.searchRetry} onClick={onRetry}>
          Retry
        </button>
      </div>
    );
  }
  if (state.status === "empty") {
    return (
      <p className={styles.noteCardsEmpty} role="status">
        No matching notes
      </p>
    );
  }
  return (
    <div className={styles.noteCards} data-testid="note-cards">
      {results.map((result) => (
        <NoteCard
          key={result.noteId}
          card={resultToCard(result, cardsById)}
          onEdit={onEditNote}
          highlight={result.matchedTerms}
          matchedField={result.matchedField}
        />
      ))}
    </div>
  );
}
