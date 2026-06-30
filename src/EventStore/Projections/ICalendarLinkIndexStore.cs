namespace EventStore.Projections;

public interface ICalendarLinkIndexStore
{
    Task<CalendarLinkView?> GetByCalendarEventIdAsync(string calendarEventId, CancellationToken ct = default);
    Task<CalendarLinkView?> GetByNoteIdAsync(string noteId, CancellationToken ct = default);
    Task<IReadOnlyList<CalendarLinkView>> GetByRecurringSeriesIdAsync(string seriesId, CancellationToken ct = default);
    Task UpsertAsync(CalendarLinkView view, CancellationToken ct = default);
    Task<IReadOnlyList<CalendarLinkView>> GetAllAsync(CancellationToken ct = default);
    Task DeleteByNoteIdAsync(string noteId, CancellationToken ct = default);
    Task DeleteAsync(string calendarEventId, CancellationToken ct = default);
    // Delete the row for calendarEventId only if it is still owned by noteId. Guards the unlink
    // projection (Phase 44 re-link) against an at-least-once redelivery — or cross-stream reorder —
    // of a stale NoteUnlinkedFromCalendarEvent clobbering a link another note has since made to that
    // meeting.
    Task DeleteForNoteAsync(string calendarEventId, string noteId, CancellationToken ct = default);
    Task DeleteAllAsync(CancellationToken ct = default);
}
