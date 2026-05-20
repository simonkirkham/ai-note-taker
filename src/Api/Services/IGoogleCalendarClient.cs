namespace Api.Services;

public interface IGoogleCalendarClient
{
    Task<IReadOnlyList<CalendarEvent>?> GetTodaysEventsAsync(string ianaTimezone);
}

public record CalendarEvent(
    string CalendarEventId,
    string Title,
    DateTimeOffset StartTime,
    DateTimeOffset EndTime,
    bool IsRecurring,
    string? RecurringSeriesId
);
