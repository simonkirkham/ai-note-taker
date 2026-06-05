using EventStore.Projections;

namespace Api.Integration;

internal sealed class InMemoryCalendarLinkIndexStore : ICalendarLinkIndexStore
{
    private readonly Dictionary<string, CalendarLinkView> _byCalendarEventId = new();

    public Task<CalendarLinkView?> GetByCalendarEventIdAsync(string calendarEventId, CancellationToken ct = default) =>
        Task.FromResult(_byCalendarEventId.TryGetValue(calendarEventId, out var view) ? view : null);

    public Task<CalendarLinkView?> GetByNoteIdAsync(string noteId, CancellationToken ct = default) =>
        Task.FromResult(_byCalendarEventId.Values.FirstOrDefault(v => v.NoteId == noteId));

    public Task<IReadOnlyList<CalendarLinkView>> GetByRecurringSeriesIdAsync(string seriesId, CancellationToken ct = default)
    {
        IReadOnlyList<CalendarLinkView> results = _byCalendarEventId.Values
            .Where(v => v.RecurringSeriesId == seriesId)
            .ToList()
            .AsReadOnly();
        return Task.FromResult(results);
    }

    public Task UpsertAsync(CalendarLinkView view, CancellationToken ct = default)
    {
        _byCalendarEventId[view.CalendarEventId] = view;
        return Task.CompletedTask;
    }

    public Task DeleteByNoteIdAsync(string noteId, CancellationToken ct = default)
    {
        var keys = _byCalendarEventId
            .Where(kvp => kvp.Value.NoteId == noteId)
            .Select(kvp => kvp.Key)
            .ToList();
        foreach (var key in keys)
            _byCalendarEventId.Remove(key);
        return Task.CompletedTask;
    }

    public Task DeleteAllAsync(CancellationToken ct = default)
    {
        _byCalendarEventId.Clear();
        return Task.CompletedTask;
    }
}
