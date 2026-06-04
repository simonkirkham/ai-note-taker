import { useEffect, useMemo, useState } from "react";
import { CalendarMeeting, createNoteFromMeeting, createNoteFromNextOccurrence, getMeetingsForDate } from "../api";
import { MeetingReminder, useMeetingReminders } from "../hooks/useMeetingReminders";
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

// "Which day" is owned by the client: format the current date in the user's tz as ISO YYYY-MM-DD.
function todayInTz(tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());
}

// Step an ISO YYYY-MM-DD day by n, calculating in UTC so no DST/midnight shift moves the date.
function addDays(isoDate: string, n: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function dayDelta(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

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

async function loadState(tz: string, date: string): Promise<State> {
  try {
    const result = await getMeetingsForDate(tz, date);
    return "error" in result ? { status: "unavailable" } : { status: "loaded", meetings: result.meetings };
  } catch {
    return { status: "unavailable" };
  }
}

export function MeetingsSection({ onOpenNote }: { onOpenNote: (noteId: string, title?: string, isNew?: boolean) => void }) {
  const tz = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);
  const [today] = useState(() => todayInTz(tz));
  const [selectedDate, setSelectedDate] = useState(today);
  const [pickerOpen, setPickerOpen] = useState(false);
  // todayState is fetched once and feeds the reminders hook; navigation never re-drives it.
  const [todayState, setTodayState] = useState<State>({ status: "loading" });
  // browsed backs the displayed list only while looking at a non-today day. Keyed by date so a
  // result left over from a previous day reads as "still loading" until the new day resolves.
  const [browsed, setBrowsed] = useState<{ date: string; state: State } | null>(null);
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [creating, setCreating] = useState<Set<string>>(new Set());
  const [createErrors, setCreateErrors] = useState<Map<string, string>>(new Map());
  // tracks recurringSeriesIds where a next-occurrence note is being created
  const [creatingNext, setCreatingNext] = useState<Set<string>>(new Set());
  // tracks next-occurrence note IDs keyed by recurringSeriesId, for "Open Note ↗" after creation
  const [nextNoteIds, setNextNoteIds] = useState<Map<string, string>>(new Map());

  const isToday = selectedDate === today;
  const displayState: State = isToday
    ? todayState
    : browsed?.date === selectedDate
      ? browsed.state
      : { status: "loading" };

  // Reminders are anchored to the real today — fed only by todayState, never the browsed day.
  const reminderMeetings = todayState.status === "loaded" ? todayState.meetings : NO_MEETINGS;
  useMeetingReminders(reminderMeetings);

  // Fetch today's meetings once on mount; this is both the reminder source and the today view.
  useEffect(() => {
    let cancelled = false;
    loadState(tz, today).then((s) => { if (!cancelled) setTodayState(s); });
    return () => { cancelled = true; };
  }, [tz, today]);

  // Browsing another day fetches it; back on today we reuse todayState (no duplicate request).
  // While the fetch is in flight, displayState derives "loading" because browsed.date !== selectedDate.
  useEffect(() => {
    if (isToday) return;
    let cancelled = false;
    loadState(tz, selectedDate).then((s) => { if (!cancelled) setBrowsed({ date: selectedDate, state: s }); });
    return () => { cancelled = true; };
  }, [tz, selectedDate, isToday]);

  const showBanner =
    !bannerDismissed &&
    typeof Notification !== "undefined" &&
    Notification.permission === "default";

  useEffect(() => {
    if (showBanner) document.body.classList.add("has-notification-banner");
    else document.body.classList.remove("has-notification-banner");
    return () => document.body.classList.remove("has-notification-banner");
  }, [showBanner]);

  function updateDisplayedMeetings(updater: (meetings: CalendarMeeting[]) => CalendarMeeting[]) {
    if (isToday) {
      setTodayState((prev) => (prev.status === "loaded" ? { ...prev, meetings: updater(prev.meetings) } : prev));
    } else {
      setBrowsed((prev) =>
        prev && prev.state.status === "loaded"
          ? { ...prev, state: { ...prev.state, meetings: updater(prev.state.meetings) } }
          : prev
      );
    }
  }

  async function handleEnable() {
    try { await Notification.requestPermission(); } catch { /* unavailable */ }
    setBannerDismissed(true);
  }

  async function handleCreateNote(meeting: CalendarMeeting) {
    setCreating((prev) => new Set(prev).add(meeting.calendarEventId));
    setCreateErrors((prev) => { const next = new Map(prev); next.delete(meeting.calendarEventId); return next; });
    try {
      const { noteId } = await createNoteFromMeeting(meeting);
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
      const result = await createNoteFromNextOccurrence(seriesId);
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
    if (isToday) {
      setTodayState({ status: "loading" });
      loadState(tz, today).then(setTodayState);
    } else {
      setBrowsed(null);
      loadState(tz, selectedDate).then((s) => setBrowsed({ date: selectedDate, state: s }));
    }
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
