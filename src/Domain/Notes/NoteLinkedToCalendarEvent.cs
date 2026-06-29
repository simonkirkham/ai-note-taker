namespace Domain.Notes;

public record NoteLinkedToCalendarEvent(
    NoteId NoteId,
    string CalendarEventId,
    string CalendarEventTitle,
    DateTimeOffset StartTime,
    DateTimeOffset EndTime,
    bool IsRecurring,
    string? RecurringSeriesId
) : NoteEvent;
