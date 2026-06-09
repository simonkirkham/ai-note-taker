import { useState } from "react";
import { NoteCard as NoteCardData } from "../api/notes";
import Highlight from "./Highlight";
import { PencilIcon, TrashIcon } from "./icons";
import styles from "./NoteCard.module.css";

const FIELD_LABELS: Record<string, string> = {
  title: "title",
  tag: "tag",
  notes: "notes",
};

export default function NoteCard({
  card,
  onEdit,
  onDelete,
  highlight,
  matchedField,
}: {
  card: NoteCardData;
  onEdit: (noteId: string) => void;
  onDelete?: () => void;
  highlight?: string[];
  matchedField?: string;
}) {
  const [confirming, setConfirming] = useState(false);
  // vanished prevents a flash of the card before the parent unmounts it after onDelete
  const [vanished, setVanished] = useState(false);

  const displayDate = card.date
    ? new Date(card.date + "T00:00:00").toLocaleDateString("en-GB")
    : null;

  const tags = card.tags ?? [];
  const terms = highlight;
  const matchedLabel =
    highlight && matchedField ? FIELD_LABELS[matchedField] : undefined;
  const tagMatches = (tag: string) =>
    (terms ?? []).some((t) => t.toLowerCase() === tag.toLowerCase());

  function handleDeleteClick(e: React.MouseEvent) {
    e.stopPropagation();
    setConfirming(true);
  }

  function handleConfirm(e: React.MouseEvent) {
    e.stopPropagation();
    setVanished(true);
    setConfirming(false);
    // NoteCard is presentational: onDelete drives the parent's delete mutation
    // (optimistic cache removal + DELETE). `vanished` hides the row immediately.
    onDelete?.();
  }

  function handleCancel(e: React.MouseEvent) {
    e.stopPropagation();
    setConfirming(false);
  }

  if (vanished) return null;

  return (
    <article
      className={styles.noteCard}
      data-testid="note-card"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", card.noteId);
      }}
      onClick={() => onEdit(card.noteId)}
    >
      <div className={styles.noteCardHeader}>
        <h3 className={styles.noteCardTitle} data-testid="note-card-title">
          {card.title ? <Highlight text={card.title} terms={terms} /> : <em>Untitled</em>}
        </h3>
        {displayDate && <span className={styles.noteCardDate}>{displayDate}</span>}
      </div>
      {matchedLabel && (
        <span className={styles.matchedLabel}>matched in {matchedLabel}</span>
      )}
      {card.contentPreview && (
        <p className={styles.noteCardSnippet}>
          <Highlight text={card.contentPreview} terms={terms} />
        </p>
      )}
      {tags.length > 0 && (
        <div className={styles.noteCardTags}>
          {tags.map((tag) => (
            <span
              key={tag}
              data-testid={`card-tag-${tag}`}
              className={styles.noteCardTagPill}
            >
              {tagMatches(tag) ? <mark className={styles.mark}>{tag}</mark> : tag}
            </span>
          ))}
        </div>
      )}
      <div className={styles.noteCardActionsRow}>
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
          <span className={styles.noteCardConfirmRow}>
            <button
              className={styles.noteCardConfirmBtn}
              aria-label="Confirm delete"
              onClick={handleConfirm}
            >
              Confirm
            </button>
            <button
              className={styles.noteCardCancelBtn}
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
