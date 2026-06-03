import { useEffect, useRef, useState } from "react";
import { analyseNote, editContent, getNoteDetail, getTags, setNoteDate, tagNote, untagNote, type TagIndexEntry } from "../api";
import ActionsSection from "./ActionsSection";
import FinalNotesView from "./FinalNotesView";
import NoteEditor from "./NoteEditor";
import ShortcutsPanel from "./ShortcutsPanel";
import TagsSection from "./TagsSection";
import TranscriptionPanel from "./TranscriptionPanel";

export default function NoteView({
  noteId,
  initialTitle,
  onRename,
  onBack,
  onDelete,
  onDateSet,
  isNew,
}: {
  noteId: string;
  initialTitle: string;
  onRename: (noteId: string, title: string) => void;
  onBack: () => void;
  onDelete: (noteId: string) => Promise<void>;
  onDateSet: (noteId: string, date: string) => void;
  isNew?: boolean;
}) {
  const [title, setTitle] = useState(initialTitle);
  const [content, setContent] = useState("");
  const [date, setDate] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [allTags, setAllTags] = useState<TagIndexEntry[]>([]);
  const [actionCount, setActionCount] = useState(0);
  const [transcriptText, setTranscriptText] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [discussionPoints, setDiscussionPoints] = useState<string[]>([]);
  const [decisions, setDecisions] = useState<string[]>([]);
  const [summaryModelId, setSummaryModelId] = useState<string | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [actionsKey, setActionsKey] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const tagsModifiedRef = useRef(false);
  const contentModifiedRef = useRef(false);
  const contentRef = useRef("");

  const hasContent =
    title.trim().length > 0 ||
    content.trim().length > 0 ||
    tags.length > 0 ||
    actionCount > 0 ||
    transcriptText !== null;

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
          setTranscriptText(detail.transcriptText ?? null);
          setSummary(detail.summary ?? null);
          setDiscussionPoints(detail.discussionPoints ?? []);
          setDecisions(detail.decisions ?? []);
          setSummaryModelId(detail.summaryModelId ?? null);
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
    getTags().then(setAllTags).catch((err) => { console.error('getTags failed:', err) });
  }, []);

  useEffect(() => {
    if (!loadingDetail && !notFound) inputRef.current?.focus();
  }, [loadingDetail, notFound]);

  async function refreshNote() {
    try {
      const detail = await getNoteDetail(noteId);
      setContent(detail.content);
      if (detail.tags) setTags(detail.tags);
      setTranscriptText(detail.transcriptText ?? null);
      setSummary(detail.summary ?? null);
      setDiscussionPoints(detail.discussionPoints ?? []);
      setDecisions(detail.decisions ?? []);
      setSummaryModelId(detail.summaryModelId ?? null);
      setActionsKey((k) => k + 1);
    } catch {
      // best-effort refresh; ignore errors
    }
  }

  async function handleGenerateFinalNotes() {
    try {
      await analyseNote(noteId);
    } finally {
      await refreshNote();
    }
  }

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

  // Cancel is only reachable when !hasContent (blank note)
  async function handleCancel() {
    if (isNew) {
      await onDelete(noteId);
    } else {
      onBack();
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
      <div className="note-header">
        <div className="note-header-actions">
          {!hasContent ? (
            <button
              data-testid="cancel-button"
              onClick={handleCancel}
              className="back-button"
            >
              Cancel
            </button>
          ) : (
            <button
              data-testid="save-button"
              onClick={onBack}
              disabled={loadingDetail}
              className="save-button"
            >
              Save
            </button>
          )}
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
          {hasContent && (
            <button
              data-testid="delete-note-button"
              onClick={() => onDelete(noteId)}
              className="delete-note-button"
              aria-label="Delete note"
            >
              Delete
            </button>
          )}
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
          <TagsSection tags={tags} allTags={allTags} onAdd={handleAddTags} onRemove={handleRemoveTag} />
          <div className="actions-section">
            <ActionsSection key={actionsKey} noteId={noteId} onCountChange={setActionCount} />
          </div>
          <TranscriptionPanel noteId={noteId} initialTranscript={transcriptText} noteHasContent={content.trim().length > 0} onAnalysisComplete={refreshNote} />
          <FinalNotesView
            summary={summary}
            discussionPoints={discussionPoints}
            decisions={decisions}
            summaryModelId={summaryModelId}
            onGenerate={handleGenerateFinalNotes}
          />
        </div>
      </div>
    </main>
  );
}
