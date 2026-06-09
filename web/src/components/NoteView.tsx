import clsx from "clsx";
import { useEffect, useRef, useState } from "react";
import { type CalendarMeeting } from "../api/meetings";
import { analyseNote, editContent, getNoteDetail, setNoteDate, type LinkedMeeting, type TranscriptionDraft } from "../api/notes";
import { completeTranscription, discardTranscriptionDraft } from "../api/transcription";
import { useCreateNoteFromNextOccurrence, useLinkNoteToCalendar } from "../hooks/useMeetingMutations";
import { useTagNote, useUntagNote } from "../hooks/useTagMutations";
import { useTags } from "../hooks/useTags";
import type { TranscriptionStatus } from "../hooks/useTranscription";
import ActionsSection from "./ActionsSection";
import FinalNotesView from "./FinalNotesView";
import MeetingPicker from "./MeetingPicker";
import NoteEditor from "./NoteEditor";
import tabStyles from "./NoteTabs.module.css";
import styles from "./NoteView.module.css";
import RecordControl from "./RecordControl";
import ShortcutsPanel from "./ShortcutsPanel";
import TagsSection from "./TagsSection";
import { useToast } from "./toastContext";
import TranscriptTab from "./TranscriptTab";

type NoteTab = "quick" | "transcript" | "final";

const TABS: { id: NoteTab; label: string }[] = [
  { id: "quick", label: "Quick notes" },
  { id: "transcript", label: "Transcript" },
  { id: "final", label: "Final notes" },
];

export default function NoteView({
  noteId,
  initialTitle,
  onRename,
  onBack,
  onDelete,
  onDateSet,
  onOpenNote,
  onNotFound,
  isNew,
}: {
  noteId: string;
  initialTitle: string;
  onRename: (noteId: string, title: string) => void;
  onBack: () => void;
  onDelete: (noteId: string) => Promise<void>;
  onDateSet: (noteId: string, date: string) => void;
  onOpenNote: (noteId: string, title?: string, isNew?: boolean) => void;
  onNotFound?: () => void;
  isNew?: boolean;
}) {
  const [title, setTitle] = useState(initialTitle);
  const [content, setContent] = useState("");
  const [date, setDate] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const { data: allTags = [] } = useTags();
  const tagNoteM = useTagNote();
  const untagNoteM = useUntagNote();
  const linkMeetingM = useLinkNoteToCalendar();
  const nextOccurrenceM = useCreateNoteFromNextOccurrence();
  const [actionCount, setActionCount] = useState(0);
  const [transcriptText, setTranscriptText] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [discussionPoints, setDiscussionPoints] = useState<string[]>([]);
  const [decisions, setDecisions] = useState<string[]>([]);
  const [summaryModelId, setSummaryModelId] = useState<string | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [actionsKey, setActionsKey] = useState(0);
  const [activeTab, setActiveTab] = useState<NoteTab>("quick");
  const [liveTranscript, setLiveTranscript] = useState<string | null>(null);
  const [recordingStatus, setRecordingStatus] = useState<TranscriptionStatus>("idle");
  const [recurringSeriesId, setRecurringSeriesId] = useState<string | null>(null);
  const [linkedMeeting, setLinkedMeeting] = useState<LinkedMeeting | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [linkingEventId, setLinkingEventId] = useState<string | null>(null);
  const [openingNext, setOpeningNext] = useState(false);
  const [noNextOccurrence, setNoNextOccurrence] = useState(false);
  const [confirmingLeave, setConfirmingLeave] = useState(false);
  const [transcriptDraft, setTranscriptDraft] = useState<TranscriptionDraft | null>(null);
  const { showError } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const tagsModifiedRef = useRef(false);
  const contentModifiedRef = useRef(false);
  const contentRef = useRef("");

  const isRecording =
    recordingStatus === "recording" || recordingStatus === "requestingCredentials";
  const displayedTranscript = liveTranscript ?? transcriptText;

  // An in-progress or just-finished recording counts as content: leaving the
  // note must "Save" (keep it) and never show "Cancel"/delete, so the captured
  // transcript persisted on unmount is not thrown away with the note.
  const hasContent =
    title.trim().length > 0 ||
    content.trim().length > 0 ||
    tags.length > 0 ||
    actionCount > 0 ||
    transcriptText !== null ||
    isRecording ||
    (liveTranscript?.trim().length ?? 0) > 0;

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
          setRecurringSeriesId(detail.recurringSeriesId ?? null);
          setLinkedMeeting(detail.linkedMeeting ?? null);
          setTranscriptDraft(detail.transcriptDraft ?? null);
          setLoadingDetail(false);
        }
      })
      .catch((err: Error) => {
        if (!cancelled) {
          // A missing note on deep-link is handled by the parent (redirect +
          // toast); without a handler, fall back to the in-place not-found view.
          if (err.message.includes("404")) {
            if (onNotFound) onNotFound();
            else setNotFound(true);
          }
          setLoadingDetail(false);
        }
      });
    return () => { cancelled = true; };
  }, [noteId, onDateSet, onNotFound]);

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

  async function handleOpenNextOccurrence() {
    if (!recurringSeriesId || openingNext) return;
    setOpeningNext(true);
    setNoNextOccurrence(false);
    try {
      const result = await nextOccurrenceM.mutateAsync(recurringSeriesId);
      onOpenNote(result.noteId, title, true);
    } catch (err) {
      if (err instanceof Error && err.message === "no_future_occurrences") {
        setNoNextOccurrence(true);
      } else {
        showError("Couldn't open the next occurrence. Please try again.");
      }
    } finally {
      setOpeningNext(false);
    }
  }

  async function handleLinkMeeting(meeting: CalendarMeeting) {
    const optimistic: LinkedMeeting = {
      calendarEventId: meeting.calendarEventId,
      title: meeting.title,
      startTime: meeting.startTime,
      endTime: meeting.endTime,
      recurringSeriesId: meeting.recurringSeriesId,
      isRecurring: meeting.isRecurring,
    };
    setLinkingEventId(meeting.calendarEventId);
    setLinkedMeeting(optimistic);
    setRecurringSeriesId(meeting.recurringSeriesId ?? null);
    setPickerOpen(false);
    try {
      await linkMeetingM.mutateAsync({ noteId, meeting });
    } catch {
      setLinkedMeeting(null);
      setRecurringSeriesId(null);
      setPickerOpen(true);
      showError("Couldn't link the meeting. Please try again.");
    } finally {
      setLinkingEventId(null);
    }
  }

  function handleAddTags(raw: string) {
    const tokens = raw.trim().split(/\s+/).filter(Boolean);
    const newTokens = tokens.filter((t) => !tags.includes(t));
    if (newTokens.length === 0) return;
    tagsModifiedRef.current = true;
    setTags((prev) => [...prev, ...newTokens]);
    // Applied tags are local note-detail state (→ 20-E); the mutation reconciles
    // the global tag index and reverts this optimistic add on failure.
    for (const token of newTokens) {
      tagNoteM.mutate({ noteId, tag: token }, {
        onError: () => setTags((prev) => prev.filter((t) => t !== token)),
      });
    }
  }

  function handleRemoveTag(tag: string) {
    tagsModifiedRef.current = true;
    setTags((prev) => prev.filter((t) => t !== tag));
    untagNoteM.mutate({ noteId, tag }, {
      onError: () => setTags((prev) => (prev.includes(tag) ? prev : [...prev, tag])),
    });
  }

  // Recovery for an interrupted recording (crash/tab close left an uncommitted
  // draft). Optimistic: hide the banner immediately and show the recovered text;
  // reconcile on error. Recover commits the draft as the durable transcript;
  // Discard drops it, leaving any previously committed transcript untouched.
  async function handleRecoverDraft() {
    const draft = transcriptDraft;
    if (!draft) return;
    const prevTranscript = transcriptText;
    setTranscriptDraft(null);
    setTranscriptText(draft.text);
    setActiveTab("transcript");
    try {
      // An interrupted recording has no reliable final duration; the text is what matters.
      await completeTranscription(noteId, draft.text, 0);
    } catch {
      setTranscriptDraft(draft);
      setTranscriptText(prevTranscript);
      showError("Couldn't recover the transcript. Please try again.");
    }
  }

  async function handleDiscardDraft() {
    const draft = transcriptDraft;
    if (!draft) return;
    setTranscriptDraft(null);
    try {
      await discardTranscriptionDraft(noteId);
    } catch {
      setTranscriptDraft(draft);
      showError("Couldn't discard the draft. Please try again.");
    }
  }

  // Leaving mid-recording stops the capture. Warn first so the user doesn't
  // walk away thinking it is still running; the transcript so far is saved
  // either way (autosave + flush on unmount).
  function handleBack() {
    if (isRecording) {
      setConfirmingLeave(true);
      return;
    }
    onBack();
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
        <button data-testid="back-button" onClick={onBack} className={styles.backButton}>
          ← Back
        </button>
        <p data-testid="note-not-found" className="empty">Note not found.</p>
      </main>
    );
  }

  return (
    <main className="container">
      <div className={styles.noteHeader}>
        <div className={styles.noteHeaderActions}>
          {!hasContent ? (
            <button
              data-testid="cancel-button"
              onClick={handleCancel}
              className={styles.backButton}
            >
              Cancel
            </button>
          ) : confirmingLeave ? (
            <span
              className={styles.leaveConfirm}
              role="alertdialog"
              aria-label="Recording in progress"
            >
              <span className={styles.leaveConfirmText}>Still recording —</span>
              <button
                data-testid="confirm-leave-button"
                onClick={() => { setConfirmingLeave(false); onBack(); }}
                className={styles.saveButton}
              >
                Leave &amp; save
              </button>
              <button
                data-testid="cancel-leave-button"
                onClick={() => setConfirmingLeave(false)}
                className={styles.backButton}
              >
                Keep recording
              </button>
            </span>
          ) : (
            <button
              data-testid="save-button"
              onClick={handleBack}
              disabled={loadingDetail}
              className={styles.saveButton}
            >
              Save
            </button>
          )}
        </div>
        <div className={styles.noteHeaderRight}>
          {recurringSeriesId && (
            <div className={styles.nextOccurrence}>
              <button
                type="button"
                data-testid="next-occurrence-button"
                onClick={handleOpenNextOccurrence}
                disabled={openingNext}
                className={styles.nextOccurrenceButton}
              >
                Next occurrence →
              </button>
              {noNextOccurrence && (
                <span
                  data-testid="no-next-occurrence"
                  role="status"
                  className={styles.noNextOccurrence}
                >
                  No upcoming occurrences
                </span>
              )}
            </div>
          )}
          <div className={styles.noteDateWrapper}>
            <input
              type="date"
              data-testid="note-date-input"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              onBlur={() => { setNoteDate(noteId, date || null); if (date) onDateSet(noteId, date); }}
              className={styles.dateInput}
              aria-label="Meeting date"
            />
          </div>
          {hasContent && (
            <button
              data-testid="delete-note-button"
              onClick={() => onDelete(noteId)}
              className={styles.deleteNoteButton}
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
        className={styles.titleInput}
        aria-label="Note title"
      />
      {transcriptDraft && (
        <div
          data-testid="transcript-recovery-banner"
          role="alertdialog"
          aria-label="Unsaved transcript from an interrupted recording"
          className={styles.recoveryBanner}
        >
          <span className={styles.recoveryText}>
            Unsaved transcript from an interrupted recording
            <span className={styles.recoveryWhen}> · {formatDraftWhen(transcriptDraft.capturedAt)}</span>
          </span>
          <button
            type="button"
            data-testid="recover-transcript-button"
            onClick={handleRecoverDraft}
            className={styles.saveButton}
          >
            Recover
          </button>
          <button
            type="button"
            data-testid="discard-transcript-button"
            onClick={handleDiscardDraft}
            className={styles.backButton}
          >
            Discard
          </button>
        </div>
      )}
      {linkedMeeting && (
        <div data-testid="linked-meeting-badge" className={styles.linkedMeetingBadge}>
          <CalendarLinkIcon />
          <span>
            Linked to <strong>{linkedMeeting.title}</strong>
            <span className={styles.linkedMeetingWhen}> · {formatMeetingWhen(linkedMeeting.startTime)}</span>
          </span>
        </div>
      )}
      {!loadingDetail && !notFound && !linkedMeeting && (
        <button
          type="button"
          data-testid="link-meeting-button"
          className={styles.linkMeetingButton}
          onClick={() => setPickerOpen(true)}
        >
          <CalendarLinkIcon />
          Link to meeting
        </button>
      )}
      {pickerOpen && (
        <MeetingPicker
          linkingEventId={linkingEventId}
          onSelect={handleLinkMeeting}
          onClose={() => setPickerOpen(false)}
        />
      )}
      <div className={tabStyles.tabLayout}>
        <div className={tabStyles.main}>
          <div className={tabStyles.tabRow}>
            <div className={tabStyles.tabs} role="tablist" aria-label="Note views">
              {TABS.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  id={`note-tab-${tab.id}`}
                  aria-selected={activeTab === tab.id}
                  aria-controls={`note-tabpanel-${tab.id}`}
                  data-testid={`note-tab-${tab.id}`}
                  className={clsx(tabStyles.tab, activeTab === tab.id && tabStyles.tabActive)}
                  onClick={() => setActiveTab(tab.id)}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <div className={tabStyles.tabRowControls}>
              <RecordControl
                noteId={noteId}
                noteHasContent={content.trim().length > 0}
                hasInitialTranscript={transcriptText !== null}
                initialTranscript={displayedTranscript}
                onTranscriptChange={setLiveTranscript}
                onStatusChange={setRecordingStatus}
                onAnalysisComplete={refreshNote}
              />
            </div>
          </div>

          <div
            role="tabpanel"
            id="note-tabpanel-quick"
            aria-labelledby="note-tab-quick"
            data-testid="note-tabpanel-quick"
            hidden={activeTab !== "quick"}
            className={tabStyles.panel}
          >
            <div className={tabStyles.contentPanel}>
              <div className={tabStyles.capturedHeader}>
                <span data-testid="captured-notes-label" className={tabStyles.capturedLabel}>
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
          </div>

          <div
            role="tabpanel"
            id="note-tabpanel-transcript"
            aria-labelledby="note-tab-transcript"
            data-testid="note-tabpanel-transcript"
            hidden={activeTab !== "transcript"}
            className={tabStyles.panel}
          >
            <TranscriptTab transcript={displayedTranscript} isRecording={isRecording} />
          </div>

          <div
            role="tabpanel"
            id="note-tabpanel-final"
            aria-labelledby="note-tab-final"
            data-testid="note-tabpanel-final"
            hidden={activeTab !== "final"}
            className={tabStyles.panel}
          >
            <FinalNotesView
              summary={summary}
              discussionPoints={discussionPoints}
              decisions={decisions}
              summaryModelId={summaryModelId}
              onGenerate={handleGenerateFinalNotes}
            />
          </div>
        </div>

        <aside className={tabStyles.sidebar} aria-label="Tags and action items">
          <TagsSection tags={tags} allTags={allTags} onAdd={handleAddTags} onRemove={handleRemoveTag} />
          <div className={tabStyles.actions}>
            <ActionsSection key={actionsKey} noteId={noteId} onCountChange={setActionCount} />
          </div>
        </aside>
      </div>
    </main>
  );
}

function formatDraftWhen(capturedAt: string): string {
  const d = new Date(capturedAt);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatMeetingWhen(startTime: string): string {
  const d = new Date(startTime);
  const day = d.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return `${day}, ${time}`;
}

function CalendarLinkIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}
