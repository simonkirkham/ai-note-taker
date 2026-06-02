import { useState } from "react";
import { NoteCard as NoteCardData, deleteNote } from "../api";
import { PencilIcon, TrashIcon } from "./icons";

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
  // vanished prevents a flash of the card before the parent unmounts it after onDelete
  const [vanished, setVanished] = useState(false);

  const displayDate = card.date
    ? new Date(card.date + "T00:00:00").toLocaleDateString("en-GB")
    : null;

  const tags = card.tags ?? [];

  function handleDeleteClick(e: React.MouseEvent) {
    e.stopPropagation();
    setConfirming(true);
  }

  function handleConfirm(e: React.MouseEvent) {
    e.stopPropagation();
    setVanished(true);
    setConfirming(false);
    // NoteCard owns the API call; onDelete notifies the parent to update cards state.
    // No rollback: calling onDelete first lets the parent filter the card out, causing
    // this component to unmount before the async catch could restore it.
    deleteNote(card.noteId).catch(() => {});
    onDelete?.();
  }

  function handleCancel(e: React.MouseEvent) {
    e.stopPropagation();
    setConfirming(false);
  }

  if (vanished) return null;

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
      {tags.length > 0 && (
        <div className="note-card-tags">
          {tags.map((tag) => (
            <span key={tag} data-testid={`card-tag-${tag}`} className="note-card-tag-pill">{tag}</span>
          ))}
        </div>
      )}
      <div className="note-card-actions-row">
        <button
          className="icon-btn"
          aria-label="Edit note"
          onClick={(e) => { e.stopPropagation(); onEdit(card.noteId); }}
        >
          <PencilIcon />
        </button>
        {onDelete && !confirming && (
          <button
            className="icon-btn icon-btn--danger"
            aria-label={`Delete "${card.title || "Untitled"}"`}
            onClick={handleDeleteClick}
          >
            <TrashIcon />
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
