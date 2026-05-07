import "./App.css";
import { useState } from "react";
import ListView from "./components/ListView";
import NoteView from "./components/NoteView";
import Sidebar from "./components/Sidebar";
import { useNotes } from "./hooks/useNotes";

type View = { kind: "list" } | { kind: "note"; noteId: string };

export default function App() {
  const [view, setView] = useState<View>({ kind: "list" });
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { notes, loading, creating, createError, create, rename, remove } = useNotes();

  async function handleNewNote() {
    try {
      const noteId = await create();
      setView({ kind: "note", noteId });
    } catch {
      // error surfaced by hook via createError
    }
  }

  async function handleDelete(noteId: string) {
    await remove(noteId);
    setView({ kind: "list" });
  }

  const activeNoteId = view.kind === "note" ? view.noteId : undefined;

  const main =
    view.kind === "note" ? (
      <NoteView
        key={view.noteId}
        noteId={view.noteId}
        initialTitle={notes.find((n) => n.noteId === view.noteId)?.title ?? ""}
        onRename={rename}
        onBack={() => setView({ kind: "list" })}
        onDelete={handleDelete}
      />
    ) : (
      <ListView
        loading={loading}
        creating={creating}
        createError={createError}
        onNewNote={handleNewNote}
      />
    );

  return (
    <div className="app-layout">
      <button
        className="sidebar-toggle"
        aria-label="Toggle sidebar"
        onClick={() => setSidebarOpen((o) => !o)}
      >
        ☰
      </button>
      <div className={`sidebar-overlay${sidebarOpen ? " sidebar-overlay--open" : ""}`}
        onClick={() => setSidebarOpen(false)}
      />
      <Sidebar
        notes={notes}
        activeNoteId={activeNoteId}
        open={sidebarOpen}
        onSelect={(noteId) => { setView({ kind: "note", noteId }); setSidebarOpen(false); }}
        onCreate={handleNewNote}
      />
      <div className="app-main">{main}</div>
    </div>
  );
}
