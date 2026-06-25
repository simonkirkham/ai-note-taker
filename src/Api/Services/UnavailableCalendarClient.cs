namespace Api.Services;

// 34-D2: the client the factory returns for a workspace with no in-app calendar connection (now that
// the SSM/CALENDAR_PROVIDER fallback is gone). Every read returns null → the handler maps it to
// calendar_unavailable, and the UI's "Connect calendar" affordance (CHANGE-25) lets the user connect.
// ProviderName is unused on the unavailable path (the meetings response only carries it on success).
public sealed class UnavailableCalendarClient : ICalendarClient
{
    public string ProviderName => "none";

    public Task<IReadOnlyList<CalendarEvent>?> GetEventsForDayAsync(DateOnly date, string ianaTimezone) =>
        Task.FromResult<IReadOnlyList<CalendarEvent>?>(null);

    public Task<CalendarEvent?> GetNextOccurrenceAsync(string recurringSeriesId, DateTimeOffset after) =>
        Task.FromResult<CalendarEvent?>(null);
}
