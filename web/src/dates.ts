import { NoteCard } from "./api";

// Local calendar date (YYYY-MM-DD) for a Date, using the browser's local
// timezone — NOT UTC. Using UTC (toISOString().slice(0,10)) would flip a day
// early/late for users behind/ahead of UTC near midnight.
export function localDateISO(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// Today as a local calendar date string. Pass a fixed `now` in tests.
export function localTodayISO(now: Date = new Date()): string {
  return localDateISO(now);
}

// Effective date drives the today/older/future split and the sort: the
// explicit note date when set, otherwise the local calendar date of createdAt.
export function effectiveDate(card: Pick<NoteCard, "date" | "createdAt">): string {
  if (card.date) return card.date;
  return localDateISO(new Date(card.createdAt));
}

// True when the note was last modified on the given local calendar day
// (today by default). Compared as YYYY-MM-DD strings to avoid time-of-day
// and timezone drift.
export function isEditedToday(
  card: Pick<NoteCard, "lastModifiedAt">,
  today: string = localTodayISO(),
): boolean {
  return localDateISO(new Date(card.lastModifiedAt)) === today;
}
