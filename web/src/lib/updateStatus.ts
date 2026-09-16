// 53-A — how far behind this desktop copy is, and whether the update notice should show.
// Pure: the history, the clock and the dismissed marker are all passed in.
import type { ReleaseEntry } from "../types/desktop";

export type { ReleaseEntry };

export type UpdateStatus =
  | { show: false }
  | { show: true; behind: number; ageDays: number; latest: string };

const DAY_MS = 24 * 60 * 60 * 1000;

export function updateStatus({
  builtAt,
  history,
  now,
  dismissedLatest,
}: {
  builtAt: string;
  history: ReleaseEntry[];
  now: Date;
  // The newest update's build time when the user last dismissed the notice.
  dismissedLatest: string | null;
}): UpdateStatus {
  // An empty or unreadable build time parses to NaN, which no comparison passes — so a dev
  // build finds nothing newer and never shows the notice.
  const mine = Date.parse(builtAt);
  const newer = history.filter((e) => Date.parse(e.builtAt) > mine);
  if (newer.length === 0) return { show: false };

  const latest = newer.reduce((a, b) => (Date.parse(b.builtAt) > Date.parse(a.builtAt) ? b : a)).builtAt;
  if (latest === dismissedLatest) return { show: false };

  return {
    show: true,
    behind: newer.length,
    ageDays: Math.floor((now.getTime() - mine) / DAY_MS),
    latest,
  };
}
