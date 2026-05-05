import { NoteItem } from "../api";

export default function ListView({
  notes,
  loading,
  creating,
  createError,
  onNewNote,
  onOpen,
}: {
  notes: NoteItem[];
  loading: boolean;
  creating: boolean;
  createError: string | null;
  onNewNote: () => void;
  onOpen: (noteId: string) => void;
}) {
  return (
    <main className="container">
      <div className="header">
        <h1 className="title">Notes</h1>
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
      {!loading && notes.length === 0 && (
        <p className="empty">No notes yet. Create one to get started.</p>
      )}
      <ul data-testid="note-list" className="note-list">
        {notes.map((n) => (
          <li key={n.noteId} className="note-item">
            <button onClick={() => onOpen(n.noteId)} className="note-button">
              {n.title || <em className="untitled">Untitled</em>}
            </button>
          </li>
        ))}
      </ul>
    </main>
  );
}
