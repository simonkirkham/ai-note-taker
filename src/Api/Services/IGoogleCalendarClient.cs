namespace Api.Services;

public interface IGoogleCalendarClient
{
    Task<IReadOnlyList<CalendarEvent>?> GetTodaysEventsAsync(string ianaTimezone);
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
