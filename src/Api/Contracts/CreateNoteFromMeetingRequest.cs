namespace Api.Contracts;

public record CreateNoteFromMeetingRequest(
    string CalendarEventId,
    string Title,
    DateTimeOffset StartTime,
    DateTimeOffset EndTime,
    bool IsRecurring,
    string? RecurringSeriesId);
