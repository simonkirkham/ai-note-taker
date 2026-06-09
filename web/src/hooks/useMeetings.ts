import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { getMeetingsForDate } from "../api/meetings";
import { keys } from "../api/queryKeys";

// Meetings for a tz-local day, keyed by date. The Phase 16 reminders-vs-browsed
// decoupling falls out of this: call useMeetings(today) for the reminder source
// and useMeetings(selectedDate) for display — when they're the same date they
// share one cache entry (one fetch); returning to today is served from cache.
// `tz` is stable for the session, so it is not part of the key.
export function useMeetings(date: string) {
  const tz = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);
  return useQuery({
    queryKey: keys.meetings(date),
    queryFn: () => getMeetingsForDate(tz, date),
    // Keep a day's meetings fresh across navigation so returning to a day (esp.
    // today) is served from cache without a refetch — the Phase 16 "fetch today
    // once" guarantee, made intrinsic to the hook rather than relying on the
    // global default.
    staleTime: 30_000,
  });
}
