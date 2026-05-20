using Api.Services;

namespace Api.Integration;

public sealed class FakeGoogleCalendarClient : IGoogleCalendarClient
{
    private IReadOnlyList<CalendarEvent>? _events = new List<CalendarEvent>();

    public void SetEvents(IReadOnlyList<CalendarEvent> events) => _events = events;
    public void SetUnavailable() => _events = null;
    public void Reset() => _events = new List<CalendarEvent>();

    public Task<IReadOnlyList<CalendarEvent>?> GetTodaysEventsAsync(string ianaTimezone)
        => Task.FromResult(_events);
}
