import { useEffect, useMemo, useState } from "react";
import { NoteCard as NoteCardData, TagIndexEntry, getTags } from "../api";
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
  folderPath?: string[];
  currentFolderId?: string;
  onHome?: () => void;
}) {
  const [tagEntries, setTagEntries] = useState<TagIndexEntry[]>([]);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [filterMode, setFilterMode] = useState<"AND" | "OR">("AND");

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
      {!isInFolder && <TodoSection />}
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
              <NoteCard key={card.noteId} card={card} onEdit={onEditNote} />
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
