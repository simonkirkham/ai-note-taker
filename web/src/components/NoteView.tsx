import { useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { useEffect, useRef, useState } from "react";
import { type CalendarMeeting } from "../api/meetings";
import type { NoteDetail } from "../api/notes";
import { keys } from "../api/queryKeys";
import { completeTranscription, discardTranscriptionDraft } from "../api/transcription";
import { useActions } from "../hooks/useActions";
import { useCreateNoteFromNextOccurrence, useLinkNoteToCalendar } from "../hooks/useMeetingMutations";
import { useNoteDetail } from "../hooks/useNoteDetail";
import { useAnalyseNote, useEditContent, useRenameNoteDetail, useSetNoteDate } from "../hooks/useNoteDetailMutations";
import { useTagNote, useUntagNote } from "../hooks/useTagMutations";
import { useTags } from "../hooks/useTags";
import { useTranscription } from "../hooks/useTranscription";
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
  onBack,
  onDelete,
  onDateSet,
  onOpenNote,
  onNotFound,
  isNew,
}: {
  noteId: string;
  initialTitle: string;
  onBack: () => void;
  onDelete: (noteId: string) => Promise<void>;
  onDateSet: (noteId: string, date: string) => void;
  onOpenNote: (noteId: string, title?: string, isNew?: boolean) => void;
  onNotFound?: () => void;
  isNew?: boolean;
}) {
  const qc = useQueryClient();
  const { data: detail, isLoading: loadingDetail, isError, error } = useNoteDetail(noteId);
  const { data: allTags = [] } = useTags();
  // 19-E: read the action count from this note's own useActions query (same
  // queryKey as ActionsSection → deduped, no extra request) instead of the
  // child notifying the parent via an effect-fired callback prop.
  const { data: actions = [] } = useActions(noteId);
  const tagNoteM = useTagNote();
  const untagNoteM = useUntagNote();
  const linkMeetingM = useLinkNoteToCalendar();
  const nextOccurrenceM = useCreateNoteFromNextOccurrence();
  const editContentM = useEditContent(noteId);
  const setNoteDateM = useSetNoteDate(noteId);
  const renameM = useRenameNoteDetail(noteId);
  const analyseM = useAnalyseNote(noteId);
  // 19-E2: the streaming transcription hook lives in the common parent so its
  // state flows DOWN as props to RecordControl (controlled), instead of the child
  // pushing status/transcript UP via effect-fired callbacks (YMNNAE). A second
  // instance would start a second recording session, so there is exactly one.
  const transcription = useTranscription(noteId);

  // Draft pattern: displayed = draft ?? server value. While a draft is non-null the
  // user has unsaved edits, so a refetch never clobbers in-flight typing; the draft
  // resets to null on a successful save (reconcile to the server copy). BUG-21: title
  // is a draft-backed detail field too — it was previously seeded once from
  // initialTitle and never reconciled with detail.title, so it could show empty and
  // a blur then overwrote the real title with that empty value.
  const [titleDraft, setTitleDraft] = useState<string | null>(null);
  const [contentDraft, setContentDraft] = useState<string | null>(null);
  const [dateDraft, setDateDraft] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<NoteTab>("quick");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [linkingEventId, setLinkingEventId] = useState<string | null>(null);
  const [openingNext, setOpeningNext] = useState(false);
  const [noNextOccurrence, setNoNextOccurrence] = useState(false);
  const [confirmingLeave, setConfirmingLeave] = useState(false);
  const { showError } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const dateDefaultedFor = useRef<string | null>(null);
  // BUG-18: content otherwise persists only via the editor's onBlur. Removing an
  // inline image (its ✕ control preventDefaults to keep selection) never blurs the
  // editor, so the removal — and any un-blurred edit — was lost on navigate. Mirror
  // the latest draft into a ref and flush it when leaving the note; skip on delete.
  const contentDraftRef = useRef<string | null>(null);
  useEffect(() => { contentDraftRef.current = contentDraft; }, [contentDraft]);
  const deletingRef = useRef(false);

  const today = new Date().toISOString().slice(0, 10);

  // Editable fields via the draft pattern; read-only fields straight from the cache.
  const title = titleDraft ?? detail?.title ?? initialTitle;
  const content = contentDraft ?? detail?.content ?? "";
  const date = dateDraft ?? detail?.date ?? today;
  const tags = detail?.tags ?? [];
  const summary = detail?.summary ?? null;
  const discussionPoints = detail?.discussionPoints ?? [];
  const decisions = detail?.decisions ?? [];
  const summaryModelId = detail?.summaryModelId ?? null;
  const recurringSeriesId = detail?.recurringSeriesId ?? null;
  const linkedMeeting = detail?.linkedMeeting ?? null;
  const transcriptText = detail?.transcriptText ?? null;
  const transcriptDraft = detail?.transcriptDraft ?? null;

  // A missing note on deep-link is handled by the parent (redirect + toast);
  // without a handler, fall back to the in-place not-found view.
  const is404 = isError && error instanceof Error && error.message.includes("404");
  const notFound = is404 && !onNotFound;

  const isRecording =
    transcription.status === "recording" || transcription.status === "requestingCredentials";
  // Preserve the status-gate the old RecordControl effect applied: only surface the
  // live transcript while requesting/recording/just-stopped, never at idle/error.
  const liveTranscript =
    transcription.status === "requestingCredentials" ||
    transcription.status === "recording" ||
    transcription.status === "stopped"
      ? transcription.transcript
      : null;
  const displayedTranscript = liveTranscript ?? transcriptText;

  // An in-progress or just-finished recording counts as content: leaving the
  // note must "Save" (keep it) and never show "Cancel"/delete, so the captured
  // transcript persisted on unmount is not thrown away with the note.
  const hasContent =
    title.trim().length > 0 ||
    content.trim().length > 0 ||
    tags.length > 0 ||
    actions.length > 0 ||
    transcriptText !== null ||
    isRecording ||
    (liveTranscript?.trim().length ?? 0) > 0;

  useEffect(() => {
    if (is404 && onNotFound) onNotFound();
  }, [is404, onNotFound]);

  // Inform the parent of the card date on load/change, and persist a default date
  // for a date-less note (mutation call, never setState — lint-safe in an effect).
  const detailLoaded = detail != null;
  const detailDate = detail?.date;
  useEffect(() => {
    if (!detailLoaded) return;
    const t = new Date().toISOString().slice(0, 10);
    onDateSet(noteId, detailDate ?? t);
    if (detailDate == null && dateDefaultedFor.current !== noteId) {
      dateDefaultedFor.current = noteId;
      setNoteDateM.mutate(t);
    }
  }, [detailLoaded, detailDate, noteId, onDateSet, setNoteDateM]);

  useEffect(() => {
    if (!loadingDetail && !notFound) inputRef.current?.focus();
  }, [loadingDetail, notFound]);

  // Refetch the regenerated summary/discussion/decisions and any extracted actions.
  function refreshNote() {
    void qc.invalidateQueries({ queryKey: keys.note(noteId) });
    void qc.invalidateQueries({ queryKey: keys.actions(noteId) });
  }

  async function handleGenerateFinalNotes() {
    try {
      await analyseM.mutateAsync();
    } catch {
      showError("Couldn't generate final notes. Please try again.");
    }
  }

  // Persist a pending content edit. Used on editor blur AND on leave (Save/back/unmount):
  // removing an inline image never blurs the editor (its ✕ control preventDefaults to keep
  // selection), so a blur-only save loses the removal on navigate (BUG-18). Clears the draft
  // ref first so blur+leave (or Save+unmount) can't double-fire the same save; no-op when
  // there is no draft.
  function handleSaveContent() {
    const draft = contentDraftRef.current;
    if (draft == null) return;
    contentDraftRef.current = null;
    editContentM.mutate(draft, {
      onSuccess: () => setContentDraft(null),
      // Restore the ref on failure so a later leave/unmount retries the kept text
      // rather than silently dropping it (the text stays in contentDraft state too).
      onError: () => { contentDraftRef.current = draft; showError("Couldn't save your note. We kept your text — try again."); },
    });
  }
  const saveContentRef = useRef(handleSaveContent);
  useEffect(() => { saveContentRef.current = handleSaveContent; });
  // Flush on unmount (navigating away) unless we are deleting the note.
  useEffect(() => () => {
    if (!deletingRef.current) saveContentRef.current();
  }, []);

  // BUG-21: persist a title edit on blur. Never persist empty/whitespace (the
  // auto-focused input blurs on the first click/navigation) or an unchanged value;
  // in both cases just discard the draft so the field reconciles to detail.title.
  function handleSaveTitle(value: string) {
    const current = detail?.title ?? initialTitle;
    if (value.trim().length === 0 || value === current) {
      setTitleDraft(null);
      return;
    }
    renameM.mutate(value, {
      // Keep the typed title on failure (don't reset to the stale server copy) so the
      // user's edit is never silently lost; reconcile to the server copy on success.
      onSuccess: () => setTitleDraft(null),
      onError: () => showError("Couldn't rename the note. We kept your title — try again."),
    });
  }

  function handleSaveDate() {
    if (dateDraft == null) return;
    setNoteDateM.mutate(dateDraft || null, {
      onSuccess: () => { if (dateDraft) onDateSet(noteId, dateDraft); setDateDraft(null); },
      onError: () => { setDateDraft(null); showError("Couldn't save the date. Please try again."); },
    });
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

  function handleLinkMeeting(meeting: CalendarMeeting) {
    // Optimistic linkedMeeting/recurringSeriesId patch + rollback live in the
    // mutation (it owns keys.note); here we drive the picker + error surfacing.
    setLinkingEventId(meeting.calendarEventId);
    setPickerOpen(false);
    linkMeetingM.mutate({ noteId, meeting }, {
      onError: () => { setPickerOpen(true); showError("Couldn't link the meeting. Please try again."); },
      onSettled: () => setLinkingEventId(null),
    });
  }

  function handleAddTags(raw: string) {
    const tokens = raw.trim().split(/\s+/).filter(Boolean);
    const newTokens = tokens.filter((t) => !tags.includes(t));
    if (newTokens.length === 0) return;
    // The mutation optimistically patches the note cache and reverts on failure.
    for (const token of newTokens) {
      tagNoteM.mutate({ noteId, tag: token }, {
        onError: () => showError("Couldn't add the tag. Please try again."),
      });
    }
  }

  function handleRemoveTag(tag: string) {
    untagNoteM.mutate({ noteId, tag }, {
      onError: () => showError("Couldn't remove the tag. Please try again."),
    });
  }

  // Recovery for an interrupted recording (crash/tab close left an uncommitted
  // draft). Optimistic cache patch: hide the banner and show the recovered text;
  // reconcile on error. Recover commits the draft as the durable transcript;
  // Discard drops it, leaving any previously committed transcript untouched.
  async function handleRecoverDraft() {
    const draft = transcriptDraft;
    if (!draft) return;
    await qc.cancelQueries({ queryKey: keys.note(noteId) });
    const previous = qc.getQueryData<NoteDetail>(keys.note(noteId));
    qc.setQueryData<NoteDetail>(keys.note(noteId), (old) =>
      old ? { ...old, transcriptDraft: null, transcriptText: draft.text } : old);
    setActiveTab("transcript");
    try {
      // An interrupted recording has no reliable final duration; the text is what matters.
      // The optimistic patch is the post-commit state (single consumer), so no refetch.
      await completeTranscription(noteId, draft.text, 0);
    } catch {
      if (previous) qc.setQueryData(keys.note(noteId), previous);
      showError("Couldn't recover the transcript. Please try again.");
    }
  }

  async function handleDiscardDraft() {
    const draft = transcriptDraft;
    if (!draft) return;
    await qc.cancelQueries({ queryKey: keys.note(noteId) });
    const previous = qc.getQueryData<NoteDetail>(keys.note(noteId));
    qc.setQueryData<NoteDetail>(keys.note(noteId), (old) =>
      old ? { ...old, transcriptDraft: null } : old);
    try {
      await discardTranscriptionDraft(noteId);
    } catch {
      if (previous) qc.setQueryData(keys.note(noteId), previous);
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
    handleSaveContent();
    onBack();
  }

  // Cancel is only reachable when !hasContent (blank note)
  async function handleCancel() {
    if (isNew) {
      deletingRef.current = true;
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
        <p data-testid="note-not-found" className="empty" role="alert">Note not found.</p>
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
              onClick={() => void handleCancel()}
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
                onClick={() => { setConfirmingLeave(false); handleSaveContent(); onBack(); }}
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
                onClick={() => void handleOpenNextOccurrence()}
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
              onChange={(e) => setDateDraft(e.target.value)}
              onBlur={handleSaveDate}
              className={styles.dateInput}
              aria-label="Meeting date"
            />
          </div>
          {hasContent && (
            <button
              data-testid="delete-note-button"
              onClick={() => { deletingRef.current = true; void onDelete(noteId); }}
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
        onChange={(e) => setTitleDraft(e.target.value)}
        onBlur={(e) => handleSaveTitle(e.currentTarget.value)}
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
            onClick={() => void handleRecoverDraft()}
            className={styles.saveButton}
          >
            Recover
          </button>
          <button
            type="button"
            data-testid="discard-transcript-button"
            onClick={() => void handleDiscardDraft()}
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
                transcription={transcription}
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
                <p data-testid="note-loading" className="loading" role="status">Loading…</p>
              ) : (
                <NoteEditor
                  key={noteId}
                  noteId={noteId}
                  value={content}
                  onChange={(md) => setContentDraft(md)}
                  onBlur={handleSaveContent}
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
            <ActionsSection key={noteId} noteId={noteId} />
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
