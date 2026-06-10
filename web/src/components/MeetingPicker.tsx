import { type UseQueryResult } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarMeeting, type MeetingsResult } from "../api/meetings";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { useMeetings } from "../hooks/useMeetings";
import { addDays, dayDelta, formatMeetingTime, todayInTz } from "./meetingDay";
import styles from "./MeetingPicker.module.css";

type State =
  | { status: "loading" }
  | { status: "unavailable" }
  | { status: "loaded"; meetings: CalendarMeeting[] };

function headingFor(selectedDate: string, today: string): string {
  const delta = dayDelta(today, selectedDate);
  if (delta === 0) return "Today";
  if (delta === 1) return "Tomorrow";
  if (delta === -1) return "Yesterday";
  return new Date(`${selectedDate}T00:00:00Z`).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

function toState(query: UseQueryResult<MeetingsResult>): State {
  if (query.isLoading) return { status: "loading" };
  const data = query.data;
  if (!data || "error" in data) return { status: "unavailable" };
  return { status: "loaded", meetings: data.meetings };
}

export default function MeetingPicker({
  onSelect,
  onClose,
  linkingEventId,
}: {
  onSelect: (meeting: CalendarMeeting) => void;
  onClose: () => void;
  linkingEventId: string | null;
}) {
  const tz = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);
  const [today] = useState(() => todayInTz(tz));
  const [selectedDate, setSelectedDate] = useState(today);
  const [dateInputOpen, setDateInputOpen] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef);

  // A cached day shows instantly; a new day reads as loading until it resolves.
  const displayQuery = useMeetings(selectedDate);
  const displayState: State = toState(displayQuery);

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  function handleRetry() {
    displayQuery.refetch();
  }

  return (
    <div
      className={styles.overlay}
      role="dialog"
      aria-modal="true"
      aria-label="Link to a meeting"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div ref={dialogRef} className={styles.dialog} data-testid="meeting-picker">
        <header className={styles.header}>
          <h2 className={styles.title}>Link to a meeting</h2>
          <button data-testid="meeting-picker-close" aria-label="Close" onClick={onClose} className={styles.closeBtn}>
            ✕
          </button>
        </header>

        <div className={styles.nav}>
          <button data-testid="picker-prev-day" aria-label="Previous day" onClick={() => setSelectedDate((d) => addDays(d, -1))} className={styles.navBtn}>
            ‹
          </button>
          <button
            data-testid="picker-date-toggle"
            aria-label="Pick a date"
            aria-expanded={dateInputOpen}
            onClick={() => setDateInputOpen((o) => !o)}
            className={styles.navHeading}
          >
            {headingFor(selectedDate, today)}
          </button>
          <button data-testid="picker-next-day" aria-label="Next day" onClick={() => setSelectedDate((d) => addDays(d, 1))} className={styles.navBtn}>
            ›
          </button>
        </div>

        {dateInputOpen && (
          <input
            type="date"
            data-testid="picker-date-input"
            aria-label="Select a date"
            value={selectedDate}
            onChange={(e) => { if (e.target.value) setSelectedDate(e.target.value); setDateInputOpen(false); }}
            className={styles.dateInput}
          />
        )}

        {displayState.status === "loading" && <p className={styles.statusText}>Loading…</p>}

        {displayState.status === "unavailable" && (
          <div data-testid="picker-unavailable" className={styles.statusState}>
            <p className={styles.statusText}>Cannot connect to calendar</p>
            <button onClick={handleRetry} className={styles.retryBtn}>Retry</button>
          </div>
        )}

        {displayState.status === "loaded" && displayState.meetings.length === 0 && (
          <p data-testid="picker-empty" className={styles.statusText}>No meetings on this day.</p>
        )}

        {displayState.status === "loaded" && displayState.meetings.length > 0 && (
          <ul data-testid="picker-meetings" className={styles.list}>
            {displayState.meetings.map((m) => (
              <li key={m.calendarEventId} className={styles.row}>
                <div className={styles.meetingInfo}>
                  <span className={styles.meetingTitle}>{m.title}</span>
                  <span className={styles.meetingTime}>{formatMeetingTime(m.startTime)}–{formatMeetingTime(m.endTime)}</span>
                </div>
                {m.linkedNoteId ? (
                  <span data-testid={`picker-linked-${m.calendarEventId}`} className={styles.alreadyLinked}>Already linked</span>
                ) : (
                  <button
                    data-testid={`picker-link-${m.calendarEventId}`}
                    disabled={linkingEventId !== null}
                    onClick={() => onSelect(m)}
                    className={styles.linkBtn}
                  >
                    {linkingEventId === m.calendarEventId ? "Linking…" : "Link"}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
