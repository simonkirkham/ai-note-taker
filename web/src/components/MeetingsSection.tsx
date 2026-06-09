import { useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { CalendarMeeting, type MeetingsResult } from "../api/meetings";
import { keys } from "../api/queryKeys";
import { useCreateNoteFromMeeting, useCreateNoteFromNextOccurrence } from "../hooks/useMeetingMutations";
import { MeetingReminder, useMeetingReminders } from "../hooks/useMeetingReminders";
import { useMeetings } from "../hooks/useMeetings";
import { addDays, dayDelta, formatMeetingTime, todayInTz } from "./meetingDay";
import styles from "./MeetingsSection.module.css";

const NO_MEETINGS: MeetingReminder[] = [];

const CalendarIcon = ({ className, size = 36 }: { className?: string; size?: number }) => (
  <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
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

function headingFor(selectedDate: string, today: string): string {
  const delta = dayDelta(today, selectedDate);
  if (delta === 0) return "Today's Meetings";
  if (delta === 1) return "Tomorrow's Meetings";
  if (delta === -1) return "Yesterday's Meetings";
  const formatted = new Date(`${selectedDate}T00:00:00Z`).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
  return `Meetings — ${formatted}`;
}

// Derive the display State from a meetings query. A thrown fetch (network/5xx →
// data undefined) and an `{ error }` response (calendar not connected) both read
// as "unavailable"; the discriminated union lives in the query data.
function toState(query: UseQueryResult<MeetingsResult>): State {
  if (query.isLoading) return { status: "loading" };
  const data = query.data;
  if (!data || "error" in data) return { status: "unavailable" };
  return { status: "loaded", meetings: data.meetings };
}

export function MeetingsSection({ onOpenNote }: { onOpenNote: (noteId: string, title?: string, isNew?: boolean) => void }) {
  const tz = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);
  const qc = useQueryClient();
  const [today] = useState(() => todayInTz(tz));
  const [selectedDate, setSelectedDate] = useState(today);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [creating, setCreating] = useState<Set<string>>(new Set());
  const [createErrors, setCreateErrors] = useState<Map<string, string>>(new Map());
  // tracks recurringSeriesIds where a next-occurrence note is being created
  const [creatingNext, setCreatingNext] = useState<Set<string>>(new Set());
  // tracks next-occurrence note IDs keyed by recurringSeriesId, for "Open Note ↗" after creation
  const [nextNoteIds, setNextNoteIds] = useState<Map<string, string>>(new Map());

  const createNote = useCreateNoteFromMeeting();
  const createNext = useCreateNoteFromNextOccurrence();

  // Two date-keyed queries preserve the Phase 16 decoupling: the today query is the
  // reminder source (always active, cached → no refetch when returning to today);
  // the display query drives the list. When selectedDate === today they share one
  // cache key (one fetch); when browsing they are distinct and today stays untouched.
  const todayQuery = useMeetings(today);
  const displayQuery = useMeetings(selectedDate);

  const displayState: State = toState(displayQuery);

  // Reminders are anchored to the real today — fed only by the today query.
  const reminderMeetings =
    todayQuery.data && "meetings" in todayQuery.data ? todayQuery.data.meetings : NO_MEETINGS;
  useMeetingReminders(reminderMeetings);

  // Optimistically patch the displayed day's meetings in the cache (create-note flows).
  function updateDisplayedMeetings(updater: (meetings: CalendarMeeting[]) => CalendarMeeting[]) {
    qc.setQueryData<MeetingsResult>(keys.meetings(selectedDate), (old) =>
      old && "meetings" in old ? { meetings: updater(old.meetings) } : old);
  }

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
      const { noteId } = await createNote.mutateAsync(meeting);
      updateDisplayedMeetings((meetings) =>
        meetings.map((m) =>
          m.calendarEventId === meeting.calendarEventId ? { ...m, linkedNoteId: noteId } : m
        )
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
    updateDisplayedMeetings((meetings) =>
      meetings.map((m) => (m.recurringSeriesId === seriesId ? { ...m, hasNextOccurrenceNote: true } : m))
    );
    try {
      const result = await createNext.mutateAsync(seriesId);
      const noteId = result.noteId;
      setNextNoteIds((prev) => new Map(prev).set(seriesId, noteId));
      onOpenNote(noteId, meeting.title, true);
    } catch {
      // Revert optimistic update on failure
      updateDisplayedMeetings((meetings) =>
        meetings.map((m) => (m.recurringSeriesId === seriesId ? { ...m, hasNextOccurrenceNote: false } : m))
      );
    } finally {
      setCreatingNext((prev) => { const next = new Set(prev); next.delete(seriesId); return next; });
    }
  }

  function handleRetry() {
    displayQuery.refetch();
  }

  function handlePickDate(value: string) {
    if (value) setSelectedDate(value);
    setPickerOpen(false);
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
      <section data-testid="meetings-section" className={styles.meetingsSection} aria-label="Meetings">
        <div className={styles.meetingsHeader}>
          <h2 data-testid="meetings-heading" className={styles.meetingsHeading}>{headingFor(selectedDate, today)}</h2>
          <div className={styles.meetingsNav}>
            <button
              data-testid="meetings-prev-day"
              className={styles.meetingsNavBtn}
              aria-label="Previous day"
              onClick={() => setSelectedDate((d) => addDays(d, -1))}
            >
              ‹
            </button>
            <button
              data-testid="meetings-date-picker-toggle"
              className={styles.meetingsNavBtn}
              aria-label="Pick a date"
              aria-expanded={pickerOpen}
              onClick={() => setPickerOpen((open) => !open)}
            >
              <CalendarIcon size={18} />
            </button>
            <button
              data-testid="meetings-next-day"
              className={styles.meetingsNavBtn}
              aria-label="Next day"
              onClick={() => setSelectedDate((d) => addDays(d, 1))}
            >
              ›
            </button>
          </div>
        </div>

        {pickerOpen && (
          <input
            type="date"
            data-testid="meetings-date-input"
            aria-label="Select a date"
            className={styles.meetingsDateInput}
            value={selectedDate}
            onChange={(e) => handlePickDate(e.target.value)}
          />
        )}

        {displayState.status === "loading" && (
          <p className="loading">Loading…</p>
        )}

        {displayState.status === "unavailable" && (
          <div data-testid="meetings-unavailable" className={styles.meetingsStatusState}>
            <CalendarIcon className={styles.meetingsStatusIcon} />
            <p className={styles.meetingsStatusText}>Cannot connect to calendar</p>
            <button className={styles.meetingsRetryLink} onClick={handleRetry}>Retry</button>
          </div>
        )}

        {displayState.status === "loaded" && displayState.meetings.length === 0 && (
          <div data-testid="meetings-empty" className={styles.meetingsStatusState}>
            <CalendarIcon className={styles.meetingsStatusIcon} />
            <p className={styles.meetingsStatusText}>No meetings scheduled.</p>
          </div>
        )}

        {displayState.status === "loaded" && displayState.meetings.length > 0 && (
          <ul data-testid="meetings-list" className={styles.meetingsList}>
            {displayState.meetings.map((m) => (
              <li key={m.calendarEventId}>
                <article className={styles.meetingCard}>
                  <div className={styles.meetingCardHeader}>
                    <span className={styles.meetingCardTitle}>{m.title}</span>
                    <span className={styles.meetingCardTime}>
                      {formatMeetingTime(m.startTime)}–{formatMeetingTime(m.endTime)}
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

export default MeetingsSection;
