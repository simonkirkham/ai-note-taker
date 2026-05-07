import { NoteItem } from "../api";

export default function Sidebar({
  notes,
  activeNoteId,
  open,
  onSelect,
  onCreate,
}: {
  notes: NoteItem[];
  activeNoteId?: string;
  open?: boolean;
  onSelect: (noteId: string) => void;
  onCreate: () => void;
}) {
  return (
    <nav
      className={`sidebar${open ? " sidebar--open" : ""}`}
      data-testid="sidebar"
      aria-label="Notes"
    >
      <button className="sidebar-new-button" onClick={onCreate}>
        + New Note
      </button>
      <ul className="sidebar-list" data-testid="note-list">
        {notes.map((n) => (
          <li key={n.noteId}>
            <button
              className={`sidebar-note-item${n.noteId === activeNoteId ? " sidebar-note-item--active" : ""}`}
              onClick={() => onSelect(n.noteId)}
            >
              {n.title || <em className="untitled">Untitled</em>}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
