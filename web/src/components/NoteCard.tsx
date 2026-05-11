import { NoteCard as NoteCardData } from "../api";

export default function NoteCard({
  card,
  onEdit,
}: {
  card: NoteCardData;
  onEdit: (noteId: string) => void;
}) {
  const displayDate = card.date
    ? new Date(card.date + "T00:00:00").toLocaleDateString("en-GB")
    : null;

  const tags = card.tags ?? [];

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
            <span key={tag} className="note-card-tag-pill">{tag}</span>
          ))}
        </div>
      )}
      <button
        className="note-card-edit-button"
        onClick={(e) => { e.stopPropagation(); onEdit(card.noteId); }}
      >
        Edit Note
      </button>
    </article>
  );
}
