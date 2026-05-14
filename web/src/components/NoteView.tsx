import { useEffect, useRef, useState } from "react";
import { editContent, getNoteDetail, setNoteDate, tagNote, untagNote } from "../api";
import ActionsSection from "./ActionsSection";
import TagsSection from "./TagsSection";

export default function NoteView({
  noteId,
  initialTitle,
  onRename,
  onBack,
  onDelete,
  onDateSet,
}: {
  noteId: string;
  initialTitle: string;
  onRename: (noteId: string, title: string) => void;
  onBack: () => void;
  onDelete: (noteId: string) => Promise<void>;
  onDateSet: (noteId: string, date: string) => void;
}) {
  const [title, setTitle] = useState(initialTitle);
  const [content, setContent] = useState("");
  const [date, setDate] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [loadingDetail, setLoadingDetail] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const tagsModifiedRef = useRef(false);
  const contentModifiedRef = useRef(false);

  useEffect(() => {
    tagsModifiedRef.current = false;
    contentModifiedRef.current = false;
    const today = new Date().toISOString().slice(0, 10);
    let cancelled = false;
    getNoteDetail(noteId)
      .then((detail) => {
        if (!cancelled) {
          if (!contentModifiedRef.current) setContent(detail.content);
          const loadedDate = detail.date ?? today;
          setDate(loadedDate);
          onDateSet(noteId, loadedDate);
          if (!detail.date) setNoteDate(noteId, loadedDate).catch(() => {});
          if (!tagsModifiedRef.current) setTags(detail.tags ?? []);
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
  }, [noteId, onDateSet]);

  useEffect(() => {
    if (!loadingDetail && !notFound) inputRef.current?.focus();
  }, [loadingDetail, notFound]);

  function handleAddTags(raw: string) {
    const tokens = raw.trim().split(/\s+/).filter(Boolean);
    const newTokens = tokens.filter((t) => !tags.includes(t));
    if (newTokens.length === 0) return;
    tagsModifiedRef.current = true;
    setTags((prev) => [...prev, ...newTokens]);
    for (const token of newTokens) {
      tagNote(noteId, token).catch(() => {});
    }
  }

  function handleRemoveTag(tag: string) {
    tagsModifiedRef.current = true;
    setTags((prev) => prev.filter((t) => t !== tag));
    untagNote(noteId, tag).catch(() => {});
  }

  if (notFound) {
    return (
      <main className="container">
        <button data-testid="back-button" onClick={onBack} className="back-button">
          ← Save
        </button>
        <p data-testid="note-not-found" className="empty">Note not found.</p>
      </main>
    );
  }

  return (
    <main className="container">
      <div className="note-header">
        <button data-testid="back-button" onClick={onBack} className="back-button">
          ← Save
        </button>
        <div className="note-header-right">
          <div className="note-date-wrapper">
            <input
              type="date"
              data-testid="note-date-input"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              onBlur={() => { setNoteDate(noteId, date || null); if (date) onDateSet(noteId, date); }}
              className="date-input"
              aria-label="Meeting date"
            />
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
        onBlur={(e) => onRename(noteId, e.currentTarget.value)}
        placeholder="Note title…"
        className="title-input"
      />
      <div className="note-layout">
        <div className="note-content-panel">
          <span data-testid="captured-notes-label" className="captured-notes-label">
            Captured Notes
          </span>
          {loadingDetail ? (
            <p data-testid="note-loading" className="loading">Loading…</p>
          ) : (
            <textarea
              data-testid="note-content"
              aria-label="Note content"
              value={content}
              onFocus={() => { contentModifiedRef.current = true; }}
              onChange={(e) => { contentModifiedRef.current = true; setContent(e.target.value); }}
              onBlur={(e) => editContent(noteId, e.currentTarget.value)}
              placeholder="Start typing your notes…"
              className="content-input"
            />
          )}
        </div>
        <div className="note-right-panel">
          <TagsSection tags={tags} onAdd={handleAddTags} onRemove={handleRemoveTag} />
          <ActionsSection noteId={noteId} />
        </div>
      </div>
    </main>
  );
}
