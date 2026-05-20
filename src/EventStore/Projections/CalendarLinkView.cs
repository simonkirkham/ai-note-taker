namespace EventStore.Projections;

public record CalendarLinkView(
    string CalendarEventId,
    string NoteId,
    string? RecurringSeriesId,
    DateTimeOffset StartTime
);
