import { useEffect, useState } from "react";
import { CalendarMeeting, createNoteFromMeeting, getTodaysMeetings } from "../api";
import { MeetingReminder, useMeetingReminders } from "../hooks/useMeetingReminders";

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

export function MeetingsSection({ onOpenNote }: { onOpenNote: (noteId: string, title?: string) => void }) {
  const [state, setState] = useState<State>({ status: "loading" });
  const [bannerDismissed, setBannerDismissed] = useState(false);
  // tracks calendarEventIds currently being created, for pending button state
  const [creating, setCreating] = useState<Set<string>>(new Set());
  // tracks calendarEventIds that failed to create, for inline error feedback
  const [createErrors, setCreateErrors] = useState<Map<string, string>>(new Map());

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
      onOpenNote(noteId, meeting.title);
    } catch {
      setCreateErrors((prev) => new Map(prev).set(meeting.calendarEventId, "Could not create note. Try again."));
    } finally {
      setCreating((prev) => { const next = new Set(prev); next.delete(meeting.calendarEventId); return next; });
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
          className="notification-banner"
        >
          <span className="notification-banner-text">
            Enable notifications to get reminders before your meetings start.
          </span>
          <button
            data-testid="enable-notifications-button"
            onClick={handleEnable}
            className="notification-banner-enable"
          >
            Enable
          </button>
          <button
            data-testid="dismiss-notification-banner"
            onClick={() => setBannerDismissed(true)}
            aria-label="Dismiss notification banner"
            className="notification-banner-dismiss"
          >
            ✕
          </button>
        </div>
      )}
      <section data-testid="meetings-section" className="meetings-section" aria-label="Today's meetings">
        <h2 className="meetings-heading">Today's Meetings</h2>

        {state.status === "loading" && (
          <p className="loading">Loading…</p>
        )}

        {state.status === "unavailable" && (
          <div data-testid="meetings-unavailable" className="meetings-status-state">
            <CalendarIcon className="meetings-status-icon" />
            <p className="meetings-status-text">Cannot connect to calendar</p>
            <button className="meetings-retry-link" onClick={handleRetry}>Retry</button>
          </div>
        )}

        {state.status === "loaded" && state.meetings.length === 0 && (
          <div data-testid="meetings-empty" className="meetings-status-state">
            <CalendarIcon className="meetings-status-icon" />
            <p className="meetings-status-text">No meetings today.</p>
          </div>
        )}

        {state.status === "loaded" && state.meetings.length > 0 && (
          <ul data-testid="meetings-list" className="meetings-list">
            {state.meetings.map((m) => (
              <li key={m.calendarEventId}>
                <article className="meeting-card">
                  <div className="meeting-card-header">
                    <span className="meeting-card-title">{m.title}</span>
                    <span className="meeting-card-time">
                      {formatTime(m.startTime)}–{formatTime(m.endTime)}
                    </span>
                  </div>
                  <footer className="meeting-card-footer">
                    <div className="meeting-card-row">
                      {m.linkedNoteId ? (
                        <button
                          className="meeting-action-btn"
                          onClick={() => onOpenNote(m.linkedNoteId!)}
                        >
                          Open Note ↗
                        </button>
                      ) : (
                        <button
                          className="meeting-action-btn"
                          disabled={creating.has(m.calendarEventId)}
                          onClick={() => handleCreateNote(m)}
                        >
                          {creating.has(m.calendarEventId) ? "Creating…" : "Create Note"}
                        </button>
                      )}
                    </div>
                    {createErrors.has(m.calendarEventId) && (
                      <p data-testid={`create-error-${m.calendarEventId}`} className="meeting-create-error">
                        {createErrors.get(m.calendarEventId)}
                      </p>
                    )}
                    {m.isRecurring && (
                      <>
                        <div className="meeting-card-divider" />
                        <div className="meeting-card-row">
                          <span className="meeting-card-row-label">↻ Next</span>
                          <button className="meeting-action-btn">
                            {m.hasNextOccurrenceNote ? "Open Note ↗" : "Create Note"}
                          </button>
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
