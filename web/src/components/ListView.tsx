import TodoSection from "./TodoSection";

export default function ListView({
  loading,
  creating,
  createError,
  onNewNote,
}: {
  loading: boolean;
  creating: boolean;
  createError: string | null;
  onNewNote: () => void;
}) {
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
    </main>
  );
}
