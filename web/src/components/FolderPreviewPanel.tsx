import { useState } from "react";
import clsx from "clsx";
import { NoteCard } from "../api";
import { UNFILED_ID } from "../constants";
import styles from "./FolderPreviewPanel.module.css";

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
      className={clsx(
        styles.folderPreviewPanel,
        folderId && styles.folderPreviewPanelOpen,
        isDragOver && styles.folderPreviewPanelDragOver,
      )}
      data-testid="folder-preview-panel"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className={styles.folderPreviewHeader}>
        <span className={styles.folderPreviewTitle}>{folderName}</span>
        <button className={styles.folderPreviewClose} onClick={onClose} aria-label="Close">×</button>
      </div>
      {folderId && <ul className={styles.folderPreviewList}>
        {folderCards.length === 0 ? (
          <li className={styles.folderPreviewEmpty}>No notes in this folder</li>
        ) : (
          folderCards.map((c) => (
            <li
              key={c.noteId}
              className={styles.folderPreviewItem}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", c.noteId);
              }}
              onClick={() => onEditNote(c.noteId)}
            >
              <span className={styles.folderPreviewNoteTitle}>{c.title || <em>Untitled</em>}</span>
              {c.date && (
                <span className={styles.folderPreviewNoteDate}>
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
