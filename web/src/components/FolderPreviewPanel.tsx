import { useState } from "react";
import { NoteCard } from "../api";
import { UNFILED_ID } from "../constants";

export default function FolderPreviewPanel({
  folderId,
  folderName,
  cards,
  onClose,
  onEditNote,
  onDropNote,
}: {
  folderId: string | null;
  folderName: string;
  cards: NoteCard[];
  onClose: () => void;
  onEditNote: (noteId: string) => void;
  onDropNote?: (noteId: string) => void;
}) {
  const [isDragOver, setIsDragOver] = useState(false);
  const folderCards = folderId
    ? cards.filter((c) => folderId === UNFILED_ID ? !c.folderId : c.folderId === folderId)
    : [];

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (folderId) setIsDragOver(true);
  }

  function handleDragLeave(e: React.DragEvent) {
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setIsDragOver(false);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragOver(false);
    const noteId = e.dataTransfer.getData("text/plain");
    if (!noteId || !folderId) return;
    const card = cards.find((c) => c.noteId === noteId);
    const alreadyHere = folderId === UNFILED_ID
      ? card !== undefined && !card.folderId
      : card?.folderId === folderId;
    if (alreadyHere) return;
    onDropNote?.(noteId);
  }

  return (
    <div
      className={`folder-preview-panel${folderId ? " folder-preview-panel--open" : ""}${isDragOver ? " folder-preview-panel--drag-over" : ""}`}
      data-testid="folder-preview-panel"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
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
