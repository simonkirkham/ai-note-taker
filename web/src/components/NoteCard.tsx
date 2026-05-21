import { useState } from "react";
import { NoteCard as NoteCardData, deleteNote } from "../api";

export default function NoteCard({
  card,
  onEdit,
  onDelete,
}: {
  card: NoteCardData;
  onEdit: (noteId: string) => void;
  onDelete?: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [vanished, setVanished] = useState(false);

  const displayDate = card.date
    ? new Date(card.date + "T00:00:00").toLocaleDateString("en-GB")
    : null;

  const tags = card.tags ?? [];

  if (vanished) return null;

  function handleDeleteClick(e: React.MouseEvent) {
    e.stopPropagation();
    setConfirming(true);
  }

  function handleConfirm(e: React.MouseEvent) {
    e.stopPropagation();
    setVanished(true);
    setConfirming(false);
    deleteNote(card.noteId).catch(() => {});
    onDelete?.();
  }

  function handleCancel(e: React.MouseEvent) {
    e.stopPropagation();
    setConfirming(false);
  }

  return (
    <article
      className="note-card"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", card.noteId);
      }}
      onClick={() => onEdit(card.noteId)}
    >
      <div className="note-card-header">
        <h3 className="note-card-title">{card.title || <em>Untitled</em>}</h3>
        {displayDate && <span className="note-card-date">{displayDate}</span>}
      </div>
      {card.contentPreview && (
        <p className="note-card-snippet">{card.contentPreview}</p>
      )}
      {card.openActions.length > 0 && (
        <ul className="note-card-actions">
          {card.openActions.map((a) => (
            <li key={a.actionId} className="note-card-action">
              {a.description}
            </li>
          ))}
        </ul>
      )}
      {tags.length > 0 && (
        <div className="note-card-tags">
          <span className="note-card-tags-label">Tags</span>
          {tags.map((tag) => (
            <span key={tag} data-testid={`card-tag-${tag}`} className="note-card-tag-pill">{tag}</span>
          ))}
        </div>
      )}
      <div className="note-card-actions-row">
        <button
          className="note-card-edit-button"
          onClick={(e) => { e.stopPropagation(); onEdit(card.noteId); }}
        >
          Edit Note
        </button>
        {onDelete && !confirming && (
          <button
            className="note-card-delete-btn"
            aria-label={`Delete "${card.title || "Untitled"}"`}
            onClick={handleDeleteClick}
          >
            Delete
          </button>
        )}
        {confirming && (
          <span className="note-card-confirm-row">
            <button
              className="note-card-confirm-btn"
              aria-label="Confirm delete"
              onClick={handleConfirm}
            >
              Confirm
            </button>
            <button
              className="note-card-cancel-btn"
              aria-label="Cancel"
              onClick={handleCancel}
            >
              Cancel
            </button>
          </span>
        )}
      </div>
    </article>
  );
}
