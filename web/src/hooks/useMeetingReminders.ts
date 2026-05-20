import { useEffect } from "react";

export interface MeetingReminder {
  calendarEventId: string;
  title: string;
  startTime: string; // ISO 8601
}

function fireReminder(meeting: MeetingReminder): void {
  if (typeof Notification !== "undefined" && Notification.permission === "granted") {
    new Notification(meeting.title, { body: "Your meeting is starting now" });
  } else {
    alert(`Reminder: "${meeting.title}" is starting now`);
  }
}

export function useMeetingReminders(meetings: MeetingReminder[]): void {
  useEffect(() => {
    const now = Date.now();
    const timers: ReturnType<typeof setTimeout>[] = [];

    for (const meeting of meetings) {
      const msUntilStart = new Date(meeting.startTime).getTime() - now;
      if (msUntilStart <= 0) continue;
      timers.push(setTimeout(() => fireReminder(meeting), msUntilStart));
    }

    return () => {
      for (const t of timers) clearTimeout(t);
    };
  }, [meetings]);
}
