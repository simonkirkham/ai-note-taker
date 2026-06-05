namespace EventStore.Projections;

public record CalendarLinkView(
    string CalendarEventId,
    string NoteId,
    string? RecurringSeriesId,
    DateTimeOffset StartTime,
    DateTimeOffset EndTime,
    string CalendarEventTitle,
    string UserId
);
