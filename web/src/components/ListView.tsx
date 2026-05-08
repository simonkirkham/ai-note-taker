import { useEffect, useState } from "react";
import { NoteCard as NoteCardData, getNoteCards } from "../api";
import NoteCard from "./NoteCard";
import TodoSection from "./TodoSection";

export default function ListView({
  loading,
  creating,
  createError,
  onNewNote,
  onEditNote,
}: {
  loading: boolean;
  creating: boolean;
  createError: string | null;
  onNewNote: () => void;
  onEditNote: (noteId: string) => void;
}) {
  const [cards, setCards] = useState<NoteCardData[]>([]);

  useEffect(() => {
    getNoteCards().then(setCards).catch(() => {});
  }, []);

  return (
    <main className="container">
      <div className="header">
        <h1 className="title">Home</h1>
        <button
          data-testid="new-note-button"
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
      <TodoSection />
      {cards.length > 0 && (
        <section className="note-cards-section">
          <h2 className="note-cards-heading">Notes</h2>
          <div className="note-cards" data-testid="note-cards">
            {cards.map((card) => (
              <NoteCard key={card.noteId} card={card} onEdit={onEditNote} />
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
