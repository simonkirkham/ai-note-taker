import { useEffect, useState } from "react";
import { CalendarMeeting, createNoteFromMeeting, createNoteFromNextOccurrence, getTodaysMeetings } from "../api";
import { MeetingReminder, useMeetingReminders } from "../hooks/useMeetingReminders";
import styles from "./MeetingsSection.module.css";

const NO_MEETINGS: MeetingReminder[] = [];

const CalendarIcon = ({ className }: { className?: string }) => (
  <svg className={className} width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
    <line x1="16" y1="2" x2="16" y2="6"/>
    <line x1="8" y1="2" x2="8" y2="6"/>
    <line x1="3" y1="10" x2="21" y2="10"/>
  </svg>
);

type State =
  | { status: "loading" }
  | { status: "unavailable" }
  | { status: "loaded"; meetings: CalendarMeeting[] };

export function MeetingsSection({ onOpenNote }: { onOpenNote: (noteId: string, title?: string, isNew?: boolean) => void }) {
  const [state, setState] = useState<State>({ status: "loading" });
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [creating, setCreating] = useState<Set<string>>(new Set());
  const [createErrors, setCreateErrors] = useState<Map<string, string>>(new Map());
  // tracks recurringSeriesIds where a next-occurrence note is being created
  const [creatingNext, setCreatingNext] = useState<Set<string>>(new Set());
  // tracks next-occurrence note IDs keyed by recurringSeriesId, for "Open Note ↗" after creation
  const [nextNoteIds, setNextNoteIds] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    let cancelled = false;
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    getTodaysMeetings(tz)
      .then((result) => {
        if (cancelled) return;
        if ("error" in result) setState({ status: "unavailable" });
        else setState({ status: "loaded", meetings: result.meetings });
      })
      .catch(() => { if (!cancelled) setState({ status: "unavailable" }); });
    return () => { cancelled = true; };
  }, []);

  const meetings = state.status === "loaded" ? state.meetings : NO_MEETINGS;
  useMeetingReminders(meetings);

  const showBanner =
    !bannerDismissed &&
    typeof Notification !== "undefined" &&
    Notification.permission === "default";

  useEffect(() => {
    if (showBanner) document.body.classList.add("has-notification-banner");
    else document.body.classList.remove("has-notification-banner");
    return () => document.body.classList.remove("has-notification-banner");
  }, [showBanner]);

  async function handleEnable() {
    try { await Notification.requestPermission(); } catch { /* unavailable */ }
    setBannerDismissed(true);
  }

  async function handleCreateNote(meeting: CalendarMeeting) {
    setCreating((prev) => new Set(prev).add(meeting.calendarEventId));
    setCreateErrors((prev) => { const next = new Map(prev); next.delete(meeting.calendarEventId); return next; });
    try {
      const { noteId } = await createNoteFromMeeting(meeting);
      setState((prev) =>
        prev.status === "loaded"
          ? {
              ...prev,
              meetings: prev.meetings.map((m) =>
                m.calendarEventId === meeting.calendarEventId
                  ? { ...m, linkedNoteId: noteId }
                  : m
              ),
            }
          : prev
      );
      onOpenNote(noteId, meeting.title, true);
    } catch {
      setCreateErrors((prev) => new Map(prev).set(meeting.calendarEventId, "Could not create note. Try again."));
    } finally {
      setCreating((prev) => { const next = new Set(prev); next.delete(meeting.calendarEventId); return next; });
    }
  }

  async function handleCreateNextOccurrenceNote(meeting: CalendarMeeting) {
    if (!meeting.recurringSeriesId) return;
    const seriesId = meeting.recurringSeriesId;
    setCreatingNext((prev) => new Set(prev).add(seriesId));
    // Optimistic update — flip to "Open Note" before API responds
    setState((prev) =>
      prev.status === "loaded"
        ? { ...prev, meetings: prev.meetings.map((m) =>
            m.recurringSeriesId === seriesId ? { ...m, hasNextOccurrenceNote: true } : m) }
        : prev
    );
    try {
      const result = await createNoteFromNextOccurrence(seriesId);
      const noteId = result.noteId;
      setNextNoteIds((prev) => new Map(prev).set(seriesId, noteId));
      onOpenNote(noteId, meeting.title, true);
    } catch {
      // Revert optimistic update on failure
      setState((prev) =>
        prev.status === "loaded"
          ? { ...prev, meetings: prev.meetings.map((m) =>
              m.recurringSeriesId === seriesId ? { ...m, hasNextOccurrenceNote: false } : m) }
          : prev
      );
    } finally {
      setCreatingNext((prev) => { const next = new Set(prev); next.delete(seriesId); return next; });
    }
  }

  function handleRetry() {
    setState({ status: "loading" });
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    getTodaysMeetings(tz)
      .then((result) => {
        if ("error" in result) setState({ status: "unavailable" });
        else setState({ status: "loaded", meetings: result.meetings });
      })
      .catch(() => setState({ status: "unavailable" }));
  }

  return (
    <>
      {showBanner && (
        <div
          data-testid="notification-banner"
          role="status"
          className={styles.notificationBanner}
        >
          <span className={styles.notificationBannerText}>
            Enable notifications to get reminders before your meetings start.
          </span>
          <button
            data-testid="enable-notifications-button"
            onClick={handleEnable}
            className={styles.notificationBannerEnable}
          >
            Enable
          </button>
          <button
            data-testid="dismiss-notification-banner"
            onClick={() => setBannerDismissed(true)}
            aria-label="Dismiss notification banner"
            className={styles.notificationBannerDismiss}
          >
            ✕
          </button>
        </div>
      )}
      <section data-testid="meetings-section" className={styles.meetingsSection} aria-label="Today's meetings">
        <h2 className={styles.meetingsHeading}>Today's Meetings</h2>

        {state.status === "loading" && (
          <p className="loading">Loading…</p>
        )}

        {state.status === "unavailable" && (
          <div data-testid="meetings-unavailable" className={styles.meetingsStatusState}>
            <CalendarIcon className={styles.meetingsStatusIcon} />
            <p className={styles.meetingsStatusText}>Cannot connect to calendar</p>
            <button className={styles.meetingsRetryLink} onClick={handleRetry}>Retry</button>
          </div>
        )}

        {state.status === "loaded" && state.meetings.length === 0 && (
          <div data-testid="meetings-empty" className={styles.meetingsStatusState}>
            <CalendarIcon className={styles.meetingsStatusIcon} />
            <p className={styles.meetingsStatusText}>No meetings today.</p>
          </div>
        )}

        {state.status === "loaded" && state.meetings.length > 0 && (
          <ul data-testid="meetings-list" className={styles.meetingsList}>
            {state.meetings.map((m) => (
              <li key={m.calendarEventId}>
                <article className={styles.meetingCard}>
                  <div className={styles.meetingCardHeader}>
                    <span className={styles.meetingCardTitle}>{m.title}</span>
                    <span className={styles.meetingCardTime}>
                      {formatTime(m.startTime)}–{formatTime(m.endTime)}
                    </span>
                  </div>
                  <footer className={styles.meetingCardFooter}>
                    <div className={styles.meetingCardRow}>
                      {m.linkedNoteId ? (
                        <button
                          className={styles.meetingActionBtn}
                          onClick={() => onOpenNote(m.linkedNoteId!)}
                        >
                          Open Note ↗
                        </button>
                      ) : (
                        <button
                          className={styles.meetingActionBtn}
                          disabled={creating.has(m.calendarEventId)}
                          onClick={() => handleCreateNote(m)}
                        >
                          {creating.has(m.calendarEventId) ? "Creating…" : "Create Note"}
                        </button>
                      )}
                    </div>
                    {createErrors.has(m.calendarEventId) && (
                      <p data-testid={`create-error-${m.calendarEventId}`}>
                        {createErrors.get(m.calendarEventId)}
                      </p>
                    )}
                    {m.isRecurring && m.recurringSeriesId && (
                      <>
                        <div className={styles.meetingCardDivider} />
                        <div className={styles.meetingCardRow}>
                          <span className={styles.meetingCardRowLabel}>↻ Next</span>
                          {m.hasNextOccurrenceNote ? (
                            <button
                              className={styles.meetingActionBtn}
                              onClick={() => {
                                const noteId = nextNoteIds.get(m.recurringSeriesId!) ?? m.nextOccurrenceNoteId ?? "";
                                if (noteId) onOpenNote(noteId);
                              }}
                            >
                              Open Note ↗
                            </button>
                          ) : (
                            <button
                              className={styles.meetingActionBtn}
                              disabled={creatingNext.has(m.recurringSeriesId)}
                              onClick={() => handleCreateNextOccurrenceNote(m)}
                            >
                              {creatingNext.has(m.recurringSeriesId) ? "Creating…" : "Create Note"}
                            </button>
                          )}
                        </div>
                      </>
                    )}
                  </footer>
                </article>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export default MeetingsSection;
