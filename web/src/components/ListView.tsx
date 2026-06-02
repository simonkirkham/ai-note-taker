import { useEffect, useMemo, useState } from "react";
import { NoteCard as NoteCardData, TagIndexEntry, getTags } from "../api";
import { effectiveDate, isEditedToday, localTodayISO } from "../dates";
import MeetingsSection from "./MeetingsSection";
import NoteCard from "./NoteCard";
import TodoSection from "./TodoSection";
import TagFilter from "./TagFilter";

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
}) {
  const [tagEntries, setTagEntries] = useState<TagIndexEntry[]>([]);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [filterMode, setFilterMode] = useState<"AND" | "OR">("AND");
  const [showOlder, setShowOlder] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);

  useEffect(() => {
    getTags().then(setTagEntries).catch(() => {});
  }, []);

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
        <div className="header-title-group">
          {folderPath && folderPath.length > 0 && (
            <button className="folder-breadcrumb-back" onClick={onHome}>
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
        <p data-testid="create-error" className="error">
          {createError}
        </p>
      )}
      {loading && <p>Loading…</p>}
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
            <section className="note-cards-section">
              <h2 className="note-cards-heading">Notes</h2>
              <div className="note-cards" data-testid="note-cards">
                {filteredCards.map((card) => (
                  <NoteCard
                    key={card.noteId}
                    card={card}
                    onEdit={onEditNote}
                    onDelete={onDeleteNote ? () => onDeleteNote(card.noteId) : undefined}
                  />
                ))}
              </div>
            </section>
          )}
        </>
      ) : (
        <div className="home-layout">
          <div className="home-left">
            <section className="note-cards-section">
              <div className="note-cards-header">
                <h2 className="note-cards-heading">Notes</h2>
              </div>
              <div className="filters-section">
                <button
                  type="button"
                  className={`filters-toggle${filtersOpen ? " filters-toggle--open" : ""}${
                    showActiveSummary ? " filters-toggle--active" : ""
                  }`}
                  aria-expanded={filtersOpen}
                  aria-controls="home-filters-panel"
                  onClick={() => setFiltersOpen((open) => !open)}
                >
                  <span className="filters-toggle-chevron" aria-hidden="true">
                    ▸
                  </span>
                  <span className="filters-toggle-label">
                    Filters
                    {showActiveSummary && (
                      <span className="filters-toggle-summary"> · {filterSummary}</span>
                    )}
                  </span>
                </button>
                <div
                  id="home-filters-panel"
                  className="filters-panel"
                  hidden={!filtersOpen}
                >
                  {filtersOpen && (
                    <>
                      <div className="filters-group">
                        <span className="filters-group-label">Tags</span>
                        <TagFilter
                          tags={availableTags}
                          selectedTags={selectedTags}
                          mode={filterMode}
                          onToggle={toggleTag}
                          onModeChange={setFilterMode}
                          onClear={clearFilter}
                        />
                      </div>
                      <div className="filters-group">
                        <span className="filters-group-label">Other</span>
                        <label className="show-older-toggle">
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
              {homeCards.length > 0 ? (
                <div className="note-cards" data-testid="note-cards">
                  {homeCards.map((card) => (
                    <NoteCard
                      key={card.noteId}
                      card={card}
                      onEdit={onEditNote}
                      onDelete={onDeleteNote ? () => onDeleteNote(card.noteId) : undefined}
                    />
                  ))}
                </div>
              ) : (
                <p className="note-cards-empty">
                  {showOlder ? "No notes" : "No notes today"}
                </p>
              )}
            </section>
          </div>
          <aside className="home-right-panel">
            <MeetingsSection onOpenNote={onOpenNote} />
            <TodoSection />
          </aside>
        </div>
      )}
    </main>
  );
}
