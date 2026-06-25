import { useQuery } from "@tanstack/react-query";
import { getCalendarConnection } from "../api/calendarAuth";
import { keys } from "../api/queryKeys";

// Per-user calendar connection status (34-A). Drives the "Connect calendar" / "Connected as …" /
// "Reconnect" affordances. Refetches on window focus so a connect completed in this tab is
// reflected without a manual reload.
export function useCalendarConnection() {
  return useQuery({
    queryKey: keys.calendarConnection,
    queryFn: getCalendarConnection,
    staleTime: 30_000,
  });
}
