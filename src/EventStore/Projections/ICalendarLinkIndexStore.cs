namespace EventStore.Projections;

public interface ICalendarLinkIndexStore
{
    Task<CalendarLinkView?> GetByCalendarEventIdAsync(string calendarEventId, CancellationToken ct = default);
    Task<CalendarLinkView?> GetByNoteIdAsync(string noteId, CancellationToken ct = default);
    Task<IReadOnlyList<CalendarLinkView>> GetByRecurringSeriesIdAsync(string seriesId, CancellationToken ct = default);
    Task UpsertAsync(CalendarLinkView view, CancellationToken ct = default);
    Task DeleteByNoteIdAsync(string noteId, CancellationToken ct = default);
    Task DeleteAllAsync(CancellationToken ct = default);
}
