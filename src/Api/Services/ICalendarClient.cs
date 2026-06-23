namespace Api.Services;

public interface ICalendarClient
{
    // Stable identifier of the backing calendar provider ("google" | "microsoft" | "stub").
    // Surfaced on the meetings response so the UI can label which calendar it is showing.
    string ProviderName { get; }

    Task<IReadOnlyList<CalendarEvent>?> GetEventsForDayAsync(DateOnly date, string ianaTimezone);
    Task<CalendarEvent?> GetNextOccurrenceAsync(string recurringSeriesId, DateTimeOffset after);
}

public record CalendarEvent(
    string CalendarEventId,
    string Title,
    DateTimeOffset StartTime,
    DateTimeOffset EndTime,
    bool IsRecurring,
    string? RecurringSeriesId
);
