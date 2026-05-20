import { useEffect, useState } from "react";
import { CalendarMeeting, getTodaysMeetings } from "../api";

type State =
  | { status: "loading" }
  | { status: "unavailable" }
  | { status: "loaded"; meetings: CalendarMeeting[] };

export default function MeetingsSection() {
  const [state, setState] = useState<State>({ status: "loading" });

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

  return (
    <section data-testid="meetings-section" className="meetings-section" aria-label="Today's meetings">
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
