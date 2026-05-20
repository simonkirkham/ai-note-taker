using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Extensions.Logging;

namespace Api.Services;

/// <summary>
/// Calendar client driven by the STUB_CALENDAR_JSON env var.
/// Set that var to a JSON array of CalendarEventDto objects to inject
/// fake meetings without real Google credentials.
///
/// Note: GetTodaysEventsAsync returns ALL stub events regardless of date.
/// Populate STUB_CALENDAR_JSON with events whose startTime falls today.
///
/// Example value:
/// [{"calendarEventId":"s1_20260527T090000Z","title":"Weekly Sync","startTime":"2026-05-27T09:00:00Z","endTime":"2026-05-27T09:30:00Z","isRecurring":true,"recurringSeriesId":"s1"}]
/// </summary>
public sealed class StubGoogleCalendarClient : IGoogleCalendarClient
{
    private readonly IReadOnlyList<CalendarEvent> _events;
    private readonly ILogger<StubGoogleCalendarClient> _logger;

    public StubGoogleCalendarClient(ILogger<StubGoogleCalendarClient> logger)
    {
        _logger = logger;
        var json = Environment.GetEnvironmentVariable("STUB_CALENDAR_JSON") ?? "[]";
        try
        {
            var dtos = JsonSerializer.Deserialize<List<CalendarEventDto>>(json,
                new JsonSerializerOptions { PropertyNameCaseInsensitive = true }) ?? [];
            _events = dtos.Select(d => new CalendarEvent(
                d.CalendarEventId, d.Title, d.StartTime, d.EndTime, d.IsRecurring, d.RecurringSeriesId
            )).ToList();
            _logger.LogInformation("StubGoogleCalendarClient loaded {Count} stub events", _events.Count);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to parse STUB_CALENDAR_JSON; returning empty list");
            _events = [];
        }
    }

    public Task<IReadOnlyList<CalendarEvent>?> GetTodaysEventsAsync(string ianaTimezone)
        => Task.FromResult<IReadOnlyList<CalendarEvent>?>(_events);

    public Task<CalendarEvent?> GetNextOccurrenceAsync(string recurringSeriesId, DateTimeOffset after)
    {
        var next = _events
            .Where(e => e.RecurringSeriesId == recurringSeriesId && e.StartTime > after)
            .OrderBy(e => e.StartTime)
            .FirstOrDefault();
        return Task.FromResult(next);
    }

    private sealed class CalendarEventDto
    {
        public string CalendarEventId { get; set; } = "";
        public string Title { get; set; } = "";
        public DateTimeOffset StartTime { get; set; }
        public DateTimeOffset EndTime { get; set; }
        public bool IsRecurring { get; set; }
        public string? RecurringSeriesId { get; set; }
    }
}
