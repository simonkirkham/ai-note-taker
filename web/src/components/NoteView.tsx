import { useEffect, useRef, useState } from "react";
import { editContent, getNoteDetail, setNoteDate, tagNote, untagNote } from "../api";
import ActionsSection from "./ActionsSection";
import NoteEditor from "./NoteEditor";
import ShortcutsPanel from "./ShortcutsPanel";
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
  const [actionCount, setActionCount] = useState(0);
  const [loadingDetail, setLoadingDetail] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const tagsModifiedRef = useRef(false);
  const contentModifiedRef = useRef(false);
  const contentRef = useRef("");

  const isSaveEnabled =
    title.trim().length > 0 ||
    content.trim().length > 0 ||
    tags.length > 0 ||
    actionCount > 0;

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

  async function handleAddTags(raw: string) {
    const tokens = raw.trim().split(/\s+/).filter(Boolean);
    const newTokens = tokens.filter((t) => !tags.includes(t));
    if (newTokens.length === 0) return;
    tagsModifiedRef.current = true;
    setTags((prev) => [...prev, ...newTokens]);
    for (const token of newTokens) {
      await tagNote(noteId, token).catch(() => {});
    }
  }

  function handleRemoveTag(tag: string) {
    tagsModifiedRef.current = true;
    setTags((prev) => prev.filter((t) => t !== tag));
    untagNote(noteId, tag).catch(() => {});
  }

  function handleCancel() {
    if (!isSaveEnabled) {
      onBack();
    } else {
      setShowCancelDialog(true);
    }
  }

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
      {showCancelDialog && (
        <div className="cancel-dialog-overlay" data-testid="cancel-dialog">
          <div className="cancel-dialog">
            <p className="cancel-dialog-message">Discard this note?</p>
            <div className="cancel-dialog-buttons">
              <button
                data-testid="cancel-confirm-button"
                className="cancel-confirm-button"
                onClick={onBack}
              >
                Confirm
              </button>
              <button
                data-testid="cancel-keep-button"
                className="cancel-keep-button"
                onClick={() => setShowCancelDialog(false)}
              >
                Keep Editing
              </button>
            </div>
          </div>
        </div>
      )}
      <div className="note-header">
        <div className="note-header-actions">
          <button
            data-testid="cancel-button"
            onClick={handleCancel}
            className="back-button"
          >
            Cancel
          </button>
          <button
            data-testid="save-button"
            onClick={onBack}
            disabled={!isSaveEnabled}
            className="save-button"
          >
            Save
          </button>
        </div>
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
        aria-label="Note title"
      />
      <div className="note-layout">
        <div className="note-content-panel">
          <div className="captured-notes-header">
            <span data-testid="captured-notes-label" className="captured-notes-label">
              Captured Notes
            </span>
            <ShortcutsPanel />
          </div>
          {loadingDetail ? (
            <p data-testid="note-loading" className="loading">Loading…</p>
          ) : (
            <NoteEditor
              key={noteId}
              value={content}
              onChange={(md) => { contentModifiedRef.current = true; contentRef.current = md; setContent(md); }}
              onBlur={() => editContent(noteId, contentRef.current)}
            />
          )}
        </div>
        <div className="note-right-panel">
          <TagsSection tags={tags} onAdd={handleAddTags} onRemove={handleRemoveTag} />
          <ActionsSection noteId={noteId} onCountChange={setActionCount} />
        </div>
      </div>
    </main>
  );
}
