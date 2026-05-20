import { useEffect, useState } from "react";
import { CalendarMeeting, getTodaysMeetings } from "../api";
import { useMeetingReminders } from "../hooks/useMeetingReminders";

type State =
  | { status: "loading" }
  | { status: "unavailable" }
  | { status: "loaded"; meetings: CalendarMeeting[] };

export function MeetingsSection() {
  const [state, setState] = useState<State>({ status: "loading" });
  const [bannerDismissed, setBannerDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    getTodaysMeetings(tz)
      .then((result) => {
        if (cancelled) return;
        if ("error" in result) {
          setState({ status: "unavailable" });
        } else {
          setState({ status: "loaded", meetings: result.meetings });
        }
      })
      .catch(() => {
        if (!cancelled) setState({ status: "unavailable" });
      });
    return () => { cancelled = true; };
  }, []);

  const meetings = state.status === "loaded" ? state.meetings : [];
  useMeetingReminders(meetings);

  const showBanner =
    !bannerDismissed &&
    typeof Notification !== "undefined" &&
    Notification.permission === "default";

  async function handleEnable() {
    await Notification.requestPermission();
    setBannerDismissed(true);
  }

  function handleDismiss() {
    setBannerDismissed(true);
  }

  return (
    <section data-testid="meetings-section" className="meetings-section" aria-label="Today's meetings">
      {showBanner && (
        <div
          data-testid="notification-banner"
          role="alert"
          style={{
            background: "#2563eb",
            color: "#fff",
            padding: "0.75rem 1rem",
            display: "flex",
            alignItems: "center",
            gap: "0.75rem",
            width: "100%",
            boxSizing: "border-box",
          }}
        >
          <span style={{ flex: 1 }}>
            Enable notifications to get reminders before your meetings start.
          </span>
          <button
            data-testid="enable-notifications-button"
            onClick={handleEnable}
            style={{
              background: "#fff",
              color: "#2563eb",
              border: "none",
              borderRadius: "4px",
              padding: "0.25rem 0.75rem",
              cursor: "pointer",
              fontWeight: 600,
            }}
          >
            Enable
          </button>
          <button
            data-testid="dismiss-notification-banner"
            onClick={handleDismiss}
            aria-label="Dismiss notification banner"
            style={{
              background: "transparent",
              color: "#fff",
              border: "none",
              cursor: "pointer",
              fontSize: "1.1rem",
              lineHeight: 1,
            }}
          >
            ✕
          </button>
        </div>
      )}
      <h2 className="meetings-heading">Today's Meetings</h2>
      {state.status === "loading" && (
        <p className="loading">Loading…</p>
      )}
      {state.status === "unavailable" && (
        <p data-testid="meetings-unavailable" className="meetings-error">
          Cannot connect to calendar
        </p>
      )}
      {state.status === "loaded" && state.meetings.length === 0 && (
        <p data-testid="meetings-empty" className="empty">No meetings today.</p>
      )}
      {state.status === "loaded" && state.meetings.length > 0 && (
        <ul data-testid="meetings-list" className="meetings-list">
          {state.meetings.map((m) => (
            <li key={m.calendarEventId} className="meeting-item">
              <span className="meeting-title">{m.title}</span>
              <span className="meeting-time">
                {formatTime(m.startTime)} – {formatTime(m.endTime)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export default MeetingsSection;
