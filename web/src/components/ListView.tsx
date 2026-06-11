import clsx from "clsx";
import { useDeferredValue, useMemo, useState } from "react";
import { NoteCard as NoteCardData, SearchResult } from "../api/notes";
import { effectiveDate, isEditedToday, localTodayISO } from "../dates";
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
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [filterMode, setFilterMode] = useState<"AND" | "OR">("AND");
  const [showOlder, setShowOlder] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [query, setQuery] = useState("");
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
    return result.filter((c) => {
      const cardTags = c.tags ?? [];
      return filterMode === "AND"
        ? selectedTags.every((t) => cardTags.includes(t))
        : selectedTags.some((t) => cardTags.includes(t));
    });
  }, [cards, selectedTags, filterMode, currentFolderId]);

  // Home note list: today's notes (effective date today) plus anything edited
  // today, always hiding future-dated notes. "Show older notes" additionally
  // reveals past notes. Sorted reverse-chronologically by effective date, with
  // lastModifiedAt descending as the tiebreaker. The folder view does not use
  // this — it keeps showing all notes via filteredCards.
  const homeCards = useMemo(() => {
    const today = localTodayISO();
    const visible = filteredCards.filter((c) => {
      const eff = effectiveDate(c);
      if (eff > today) return false; // future-dated notes are always hidden
      if (eff === today) return true; // today
      if (isEditedToday(c, today)) return true; // edited today, dated earlier
      return showOlder; // past notes only when the toggle is on
    });
    return [...visible].sort((a, b) => {
      const ea = effectiveDate(a);
      const eb = effectiveDate(b);
      if (ea !== eb) return ea < eb ? 1 : -1; // newest effective date first
      // tiebreak: most recently modified first. Lexicographic string compare is
      // valid because both the backend (DateTimeOffset) and the optimistic card
      // (new Date().toISOString()) emit canonical UTC ISO-8601 (Z-suffixed).
      if (a.lastModifiedAt === b.lastModifiedAt) return 0;
      return a.lastModifiedAt < b.lastModifiedAt ? 1 : -1;
    });
  }, [filteredCards, showOlder]);

  function toggleTag(tag: string) {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  }

  function clearFilter() {
    setSelectedTags([]);
    setFilterMode("AND");
  }

  const isInFolder = !!currentFolderId;
  const heading = folderPath && folderPath.length > 0 ? folderPath.join(" → ") : "Home";
  // CHANGE-9 (Option D): the collapsed Filters control summarises every active
  // filter — selected tags and/or "show older" — e.g. "Filters · 2 tags · older".
  const tagCount = selectedTags.length;
  const filterSummary = [
    tagCount > 0 ? `${tagCount} ${tagCount === 1 ? "tag" : "tags"}` : null,
    showOlder ? "older" : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const showActiveSummary = !filtersOpen && filterSummary.length > 0;

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
                      <div className={styles.filtersGroup}>
                        <span className={styles.filtersGroupLabel}>Other</span>
                        <label className={styles.showOlderToggle}>
                          <input
                            type="checkbox"
                            checked={showOlder}
                            onChange={(e) => setShowOlder(e.target.checked)}
                          />
                          Show older notes
                        </label>
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
                  {homeCards.map((card) => (
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
              ) : (
                <p className={styles.noteCardsEmpty} role="status">
                  {showOlder ? "No notes" : "No notes today"}
                </p>
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
