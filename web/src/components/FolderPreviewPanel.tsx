import { useEffect, useState } from "react";
import { getNoteCards, NoteCard } from "../api";

const UNFILED_ID = "__unfiled__";

export default function FolderPreviewPanel({
  folderId,
  folderName,
  onClose,
  onEditNote,
}: {
  folderId: string | null;
  folderName: string;
  onClose: () => void;
  onEditNote: (noteId: string) => void;
}) {
  const [cards, setCards] = useState<NoteCard[]>([]);

  useEffect(() => {
    if (!folderId) return;
    setCards([]);
    getNoteCards().then(setCards).catch(() => {});
  }, [folderId]);

  const folderCards = folderId
    ? cards.filter((c) => folderId === UNFILED_ID ? !c.folderId : c.folderId === folderId)
    : [];

  return (
    <div className={`folder-preview-panel${folderId ? " folder-preview-panel--open" : ""}`}>
      <div className="folder-preview-header">
        <span className="folder-preview-title">{folderName}</span>
        <button className="folder-preview-close" onClick={onClose} aria-label="Close">×</button>
      </div>
      {folderId && <ul className="folder-preview-list">
        {folderCards.length === 0 ? (
          <li className="folder-preview-empty">No notes in this folder</li>
        ) : (
          folderCards.map((c) => (
            <li
              key={c.noteId}
              className="folder-preview-item"
              draggable
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", c.noteId);
              }}
              onClick={() => onEditNote(c.noteId)}
            >
              <span className="folder-preview-note-title">{c.title || <em>Untitled</em>}</span>
              {c.date && (
                <span className="folder-preview-note-date">
                  {new Date(c.date + "T00:00:00").toLocaleDateString("en-GB")}
                </span>
              )}
            </li>
          ))
        )}
      </ul>}
    </div>
  );
}
