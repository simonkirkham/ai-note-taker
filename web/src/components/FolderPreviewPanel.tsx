import { NoteItem } from "../api";

export default function FolderPreviewPanel({
  folderId,
  folderName,
  notes,
  noteDateMap,
  onClose,
  onEditNote,
}: {
  folderId: string | null;
  folderName: string;
  notes: NoteItem[];
  noteDateMap: Record<string, string>;
  onClose: () => void;
  onEditNote: (noteId: string) => void;
}) {
  // In this slice, folder membership comes from card.folderId (5-G wires that up fully).
  // For now the panel shows note titles available from the notes list.
  const folderNotes = folderId ? notes : [];

  return (
    <div className={`folder-preview-panel${folderId ? " folder-preview-panel--open" : ""}`}>
      <div className="folder-preview-header">
        <span className="folder-preview-title">{folderName}</span>
        <button className="folder-preview-close" onClick={onClose} aria-label="Close">×</button>
      </div>
      <ul className="folder-preview-list">
        {folderNotes.length === 0 ? (
          <li className="folder-preview-empty">No notes in this folder</li>
        ) : (
          folderNotes.map((n) => (
            <li
              key={n.noteId}
              className="folder-preview-item"
              draggable
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", n.noteId);
              }}
              onClick={() => onEditNote(n.noteId)}
            >
              <span className="folder-preview-note-title">{n.title || <em>Untitled</em>}</span>
              {noteDateMap[n.noteId] && (
                <span className="folder-preview-note-date">
                  {new Date(noteDateMap[n.noteId] + "T00:00:00").toLocaleDateString("en-GB")}
                </span>
              )}
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
