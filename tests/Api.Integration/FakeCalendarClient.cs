using Api.Services;

namespace Api.Integration;

public sealed class FakeCalendarClient : ICalendarClient
{
    private IReadOnlyList<CalendarEvent>? _events = new List<CalendarEvent>();
    private readonly Dictionary<string, CalendarEvent?> _nextOccurrences = new();

    public DateOnly? LastRequestedDate { get; private set; }

    // Defaults to "google" (the Phase 9 baseline); tests that assert the label set it explicitly.
    public string ProviderName { get; set; } = "google";

    public void SetEvents(IReadOnlyList<CalendarEvent> events) => _events = events;
    public void SetUnavailable() => _events = null;
    public void SetNextOccurrence(string seriesId, CalendarEvent? occurrence) => _nextOccurrences[seriesId] = occurrence;
    public void Reset() { _events = new List<CalendarEvent>(); _nextOccurrences.Clear(); LastRequestedDate = null; ProviderName = "google"; }

    public Task<IReadOnlyList<CalendarEvent>?> GetEventsForDayAsync(DateOnly date, string ianaTimezone)
    {
        LastRequestedDate = date;
        return Task.FromResult(_events);
    }

    public Task<CalendarEvent?> GetNextOccurrenceAsync(string recurringSeriesId, DateTimeOffset after)
        => Task.FromResult(_nextOccurrences.TryGetValue(recurringSeriesId, out var e) ? e : null);
}
