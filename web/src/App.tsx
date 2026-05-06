import "./App.css";
import { useState } from "react";
import ListView from "./components/ListView";
import NoteView from "./components/NoteView";
import { useNotes } from "./hooks/useNotes";

type View = { kind: "list" } | { kind: "note"; noteId: string };

export default function App() {
  const [view, setView] = useState<View>({ kind: "list" });
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

  if (view.kind === "note") {
    const currentTitle =
      notes.find((n) => n.noteId === view.noteId)?.title ?? "";
    return (
      <NoteView
        key={view.noteId}
        noteId={view.noteId}
        initialTitle={currentTitle}
        onRename={rename}
        onBack={() => setView({ kind: "list" })}
        onDelete={handleDelete}
      />
    );
  }

  return (
    <ListView
      notes={notes}
      loading={loading}
      creating={creating}
      createError={createError}
      onNewNote={handleNewNote}
      onOpen={(noteId) => setView({ kind: "note", noteId })}
    />
  );
}
