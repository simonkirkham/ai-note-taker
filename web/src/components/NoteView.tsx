import { useEffect, useRef, useState } from "react";
import { editContent, getNoteDetail } from "../api";

export default function NoteView({
  noteId,
  initialTitle,
  onRename,
  onBack,
}: {
  noteId: string;
  initialTitle: string;
  onRename: (noteId: string, title: string) => void;
  onBack: () => void;
}) {
  const [title, setTitle] = useState(initialTitle);
  const [content, setContent] = useState("");
  const [loadingDetail, setLoadingDetail] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    getNoteDetail(noteId)
      .then((detail) => {
        if (!cancelled) {
          setContent(detail.content);
          setLoadingDetail(false);
        }
      })
      .catch(() => {
        if (!cancelled) setLoadingDetail(false);
      });
    return () => { cancelled = true; };
  }, [noteId]);

  useEffect(() => {
    if (!loadingDetail) inputRef.current?.focus();
  }, [loadingDetail]);

  return (
    <main className="container">
      <button
        data-testid="back-button"
        onClick={onBack}
        className="back-button"
      >
        ← Back
      </button>
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
    </main>
  );
}
