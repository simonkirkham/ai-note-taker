import { useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { disconnectCalendar, type CalendarConnection } from "../api/calendarAuth";
import { CalendarMeeting, type MeetingsResult } from "../api/meetings";
import { keys } from "../api/queryKeys";
import { startCalendarConnect } from "../auth/pkce";
import { useCalendarConnection } from "../hooks/useCalendarConnection";
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

const GearIcon = ({ size = 18 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="3"/>
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
  </svg>
);

type State =
  | { status: "loading" }
  | { status: "unavailable" }
  | { status: "loaded"; meetings: CalendarMeeting[]; provider: string };

// Friendly name for the active calendar provider, or null to show no label
// (stub/local or an unknown provider).
function providerLabel(provider: string): string | null {
  switch (provider) {
    case "microsoft": return "Outlook";
    case "google": return "Google Calendar";
    default: return null;
  }
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

// Derive the display State from a meetings query. A thrown fetch (network/5xx →
// data undefined) and an `{ error }` response (calendar not connected) both read
// as "unavailable"; the discriminated union lives in the query data.
function toState(query: UseQueryResult<MeetingsResult>): State {
  if (query.isLoading) return { status: "loading" };
  const data = query.data;
  if (!data || "error" in data) return { status: "unavailable" };
  return { status: "loaded", meetings: data.meetings, provider: data.provider };
}

export function MeetingsSection({ onOpenNote }: { onOpenNote: (noteId: string, title?: string, isNew?: boolean) => void }) {
  const tz = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);
  const qc = useQueryClient();
  const [today] = useState(() => todayInTz(tz));
  const [selectedDate, setSelectedDate] = useState(today);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [calendarMenuOpen, setCalendarMenuOpen] = useState(false);
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
  const sourceLabel = displayState.status === "loaded" ? providerLabel(displayState.provider) : null;
  const connection = useCalendarConnection();
  const connectedEmail = connection.data?.status === "connected" ? connection.data.email : null;
  const needsAuth = connection.data?.status === "needs_auth";

  // Reminders are anchored to the real today — fed only by the today query.
  const reminderMeetings =
    todayQuery.data && "meetings" in todayQuery.data ? todayQuery.data.meetings : NO_MEETINGS;
  useMeetingReminders(reminderMeetings);

  // Optimistically patch the displayed day's meetings in the cache (create-note flows).
  function updateDisplayedMeetings(updater: (meetings: CalendarMeeting[]) => CalendarMeeting[]) {
    qc.setQueryData<MeetingsResult>(keys.meetings(selectedDate), (old) =>
      old && "meetings" in old ? { ...old, meetings: updater(old.meetings) } : old);
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
    void displayQuery.refetch();
  }

  // Disconnect the workspace's in-app calendar. Optimistically flip the connection to needs_auth so
  // the header updates immediately, then refetch meetings (they may still load via the legacy SSM
  // fallback until 34-D). A failed disconnect reconciles on the next connection refetch.
  async function handleDisconnect() {
    setCalendarMenuOpen(false);
    qc.setQueryData<CalendarConnection>(keys.calendarConnection, { status: "needs_auth", provider: null, email: null });
    try {
      await disconnectCalendar();
    } finally {
      void qc.invalidateQueries({ queryKey: keys.calendarConnection });
      void qc.invalidateQueries({ queryKey: keys.meetings(selectedDate) });
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
            onClick={() => void handleEnable()}
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
          <div className={styles.meetingsHeadingGroup}>
            <h2 data-testid="meetings-heading" className={styles.meetingsHeading}>{headingFor(selectedDate, today)}</h2>
            {connectedEmail ? (
              <span
                data-testid="calendar-connected-as"
                className={styles.calendarSource}
                aria-label={`Connected calendar: ${connectedEmail}`}
              >
                <CalendarIcon size={12} /> Connected as {connectedEmail}
              </span>
            ) : sourceLabel && (
              <span
                data-testid="calendar-source-label"
                className={styles.calendarSource}
                aria-label={`Calendar source: ${sourceLabel}`}
              >
                <CalendarIcon size={12} /> {sourceLabel}
              </span>
            )}
          </div>
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
            <button
              data-testid="calendar-settings-toggle"
              className={styles.meetingsNavBtn}
              aria-label="Calendar settings"
              aria-expanded={calendarMenuOpen}
              onClick={() => setCalendarMenuOpen((open) => !open)}
            >
              <GearIcon size={16} />
            </button>
          </div>
        </div>

        {/* CHANGE-25: always-available connect/change/disconnect — reachable even when meetings load
            (via an in-app connection or the legacy SSM fallback), not only in the unavailable state. */}
        {calendarMenuOpen && (
          <div data-testid="calendar-menu" className={styles.calendarMenu} role="group" aria-label="Calendar connection">
            <p className={styles.calendarMenuStatus}>
              {connectedEmail
                ? `Connected as ${connectedEmail}`
                : needsAuth
                  ? "No calendar connected"
                  : sourceLabel
                    ? `Using ${sourceLabel}`
                    : "No calendar connected"}
            </p>
            <button
              data-testid="menu-connect-google"
              className={styles.meetingsRetryLink}
              onClick={() => void startCalendarConnect("google")}
            >
              Connect Google Calendar
            </button>
            <button
              data-testid="menu-connect-outlook"
              className={styles.meetingsRetryLink}
              onClick={() => void startCalendarConnect("microsoft")}
            >
              Connect Outlook
            </button>
            {connectedEmail && (
              <button
                data-testid="menu-disconnect"
                className={styles.meetingsRetryLink}
                onClick={() => void handleDisconnect()}
              >
                Disconnect
              </button>
            )}
          </div>
        )}

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
          <p className="loading" role="status">Loading…</p>
        )}

        {displayState.status === "unavailable" && (
          <div data-testid="meetings-unavailable" className={styles.meetingsStatusState} role="alert">
            <CalendarIcon className={styles.meetingsStatusIcon} />
            <p className={styles.meetingsStatusText}>
              {needsAuth ? "Connect your calendar to see your meetings" : "Cannot connect to calendar"}
            </p>
            {/* 34-C: choose the calendar provider. Re-running either connect overwrites the
                workspace's connection, so both buttons serve the "Reconnect" case too. */}
            <button
              data-testid="connect-calendar"
              className={styles.meetingsRetryLink}
              onClick={() => void startCalendarConnect("google")}
            >
              {needsAuth ? "Connect Google Calendar" : "Reconnect Google"}
            </button>
            <button
              data-testid="connect-outlook"
              className={styles.meetingsRetryLink}
              onClick={() => void startCalendarConnect("microsoft")}
            >
              {needsAuth ? "Connect Outlook" : "Reconnect Outlook"}
            </button>
            {!needsAuth && (
              <button className={styles.meetingsRetryLink} onClick={handleRetry}>Retry</button>
            )}
          </div>
        )}

        {displayState.status === "loaded" && displayState.meetings.length === 0 && (
          <div data-testid="meetings-empty" className={styles.meetingsStatusState} role="status">
            <CalendarIcon className={styles.meetingsStatusIcon} />
            <p className={styles.meetingsStatusText}>No meetings scheduled.</p>
          </div>
        )}

        {displayState.status === "loaded" && displayState.meetings.length > 0 && (
          <ul data-testid="meetings-list" className={styles.meetingsList}>
            {displayState.meetings.map((m) => {
              // Narrow recurringSeriesId once so the nested onClick callback can read it
              // as a string without a non-null assertion (it widens back inside the closure).
              const seriesId = m.recurringSeriesId;
              return (
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
                          onClick={() => { if (m.linkedNoteId) onOpenNote(m.linkedNoteId); }}
                        >
                          Open Note ↗
                        </button>
                      ) : (
                        <button
                          className={styles.meetingActionBtn}
                          disabled={creating.has(m.calendarEventId)}
                          onClick={() => void handleCreateNote(m)}
                        >
                          {creating.has(m.calendarEventId) ? "Creating…" : "Create Note"}
                        </button>
                      )}
                    </div>
                    {createErrors.has(m.calendarEventId) && (
                      <p data-testid={`create-error-${m.calendarEventId}`} role="alert">
                        {createErrors.get(m.calendarEventId)}
                      </p>
                    )}
                    {m.isRecurring && seriesId && (
                      <>
                        <div className={styles.meetingCardDivider} />
                        <div className={styles.meetingCardRow}>
                          <span className={styles.meetingCardRowLabel}>↻ Next</span>
                          {m.hasNextOccurrenceNote ? (
                            <button
                              className={styles.meetingActionBtn}
                              onClick={() => {
                                const noteId = nextNoteIds.get(seriesId) ?? m.nextOccurrenceNoteId ?? "";
                                if (noteId) onOpenNote(noteId);
                              }}
                            >
                              Open Note ↗
                            </button>
                          ) : (
                            <button
                              className={styles.meetingActionBtn}
                              disabled={creatingNext.has(seriesId)}
                              onClick={() => void handleCreateNextOccurrenceNote(m)}
                            >
                              {creatingNext.has(seriesId) ? "Creating…" : "Create Note"}
                            </button>
                          )}
                        </div>
                      </>
                    )}
                  </footer>
                </article>
              </li>
              );
            })}
          </ul>
        )}
      </section>
    </>
  );
}

export default MeetingsSection;
