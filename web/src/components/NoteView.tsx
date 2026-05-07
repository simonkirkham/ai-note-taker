import { useEffect, useRef, useState } from "react";
import { editContent, getNoteDetail, setNoteDate } from "../api";
import ActionsSection from "./ActionsSection";

function formatDateDisplay(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

export default function NoteView({
  noteId,
  initialTitle,
  onRename,
  onBack,
  onDelete,
}: {
  noteId: string;
  initialTitle: string;
  onRename: (noteId: string, title: string) => void;
  onBack: () => void;
  onDelete: (noteId: string) => Promise<void>;
}) {
  const [title, setTitle] = useState(initialTitle);
  const [content, setContent] = useState("");
  const [date, setDate] = useState("");
  const [loadingDetail, setLoadingDetail] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    getNoteDetail(noteId)
      .then((detail) => {
        if (!cancelled) {
          setContent(detail.content);
          setDate(detail.date ?? "");
          setLoadingDetail(false);
        }
      })
      .catch((err: Error) => {
        if (!cancelled) {
          if (err.message.includes("404")) setNotFound(true);
          setLoadingDetail(false);
        }
      });
    return () => { cancelled = true; };
  }, [noteId]);

  useEffect(() => {
    if (!loadingDetail && !notFound) inputRef.current?.focus();
  }, [loadingDetail, notFound]);

  if (notFound) {
    return (
      <main className="container">
        <button data-testid="back-button" onClick={onBack} className="back-button">
          ← Back
        </button>
        <p data-testid="note-not-found" className="empty">Note not found.</p>
      </main>
    );
  }

  return (
    <main className="container">
      <div className="note-header">
        <button data-testid="back-button" onClick={onBack} className="back-button">
          ← Back
        </button>
        <div className="note-header-right">
          <div className="note-date-wrapper">
            <input
              type="date"
              data-testid="note-date-input"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              onBlur={() => setNoteDate(noteId, date || null)}
              className="date-input"
              aria-label="Meeting date"
            />
            {date && (
              <span data-testid="note-date-display" className="date-display">
                {formatDateDisplay(date)}
              </span>
            )}
          </div>
          <button
            data-testid="delete-note-button"
            onClick={() => onDelete(noteId)}
            className="delete-note-button"
            aria-label="Delete note"
          >
            Delete
          </button>
        </div>
      </div>
      <input
        data-testid="note-title-input"
        ref={inputRef}
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={() => onRename(noteId, title)}
        placeholder="Note title…"
        className="title-input"
      />
      {loadingDetail ? (
        <p data-testid="note-loading" className="loading">Loading…</p>
      ) : (
        <textarea
          data-testid="note-content"
          aria-label="Note content"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onBlur={() => editContent(noteId, content)}
          placeholder="Start typing your notes…"
          className="content-input"
        />
      )}
      <ActionsSection noteId={noteId} />
    </main>
  );
}
