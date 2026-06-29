namespace Api.Contracts;

public record LinkNoteToCalendarRequest(
    string CalendarEventId,
    string CalendarEventTitle,
    DateTimeOffset StartTime,
    DateTimeOffset EndTime,
    bool IsRecurring,
    string? RecurringSeriesId
);
