namespace Domain.Notes;

public record LinkNoteToCalendarEvent(
    NoteId NoteId,
    string CalendarEventId,
    string CalendarEventTitle,
    DateTimeOffset StartTime,
    DateTimeOffset EndTime,
    bool IsRecurring,
    string? RecurringSeriesId
) : NoteCommand;
