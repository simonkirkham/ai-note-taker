using Api.Services;

namespace Api.Integration;

public sealed class FakeGoogleCalendarClient : IGoogleCalendarClient
{
    private IReadOnlyList<CalendarEvent>? _events = new List<CalendarEvent>();
    private readonly Dictionary<string, CalendarEvent?> _nextOccurrences = new();

    public void SetEvents(IReadOnlyList<CalendarEvent> events) => _events = events;
    public void SetUnavailable() => _events = null;
    public void SetNextOccurrence(string seriesId, CalendarEvent? occurrence) => _nextOccurrences[seriesId] = occurrence;
    public void Reset() { _events = new List<CalendarEvent>(); _nextOccurrences.Clear(); }

    public Task<IReadOnlyList<CalendarEvent>?> GetTodaysEventsAsync(string ianaTimezone)
        => Task.FromResult(_events);

    public Task<CalendarEvent?> GetNextOccurrenceAsync(string recurringSeriesId, DateTimeOffset after)
        => Task.FromResult(_nextOccurrences.TryGetValue(recurringSeriesId, out var e) ? e : null);
}
