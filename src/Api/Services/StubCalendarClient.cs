using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Extensions.Logging;

namespace Api.Services;

/// <summary>
/// Provider-agnostic calendar client driven by the STUB_CALENDAR_JSON env var.
/// Set that var to a JSON array of CalendarEventDto objects to inject
/// fake meetings without real calendar credentials (Google or Microsoft).
///
/// Note: GetEventsForDayAsync returns the stub events whose start time falls on
/// the requested date in the caller's timezone. Populate STUB_CALENDAR_JSON with
/// events on the day you want to browse.
///
/// Example value:
/// [{"calendarEventId":"s1_20260527T090000Z","title":"Weekly Sync","startTime":"2026-05-27T09:00:00Z","endTime":"2026-05-27T09:30:00Z","isRecurring":true,"recurringSeriesId":"s1"}]
/// </summary>
public sealed class StubCalendarClient : ICalendarClient
{
    private readonly IReadOnlyList<CalendarEvent> _events;
    private readonly ILogger<StubCalendarClient> _logger;

    public StubCalendarClient(ILogger<StubCalendarClient> logger)
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
            _logger.LogInformation("StubCalendarClient loaded {Count} stub events", _events.Count);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to parse STUB_CALENDAR_JSON; returning empty list");
            _events = [];
        }
    }

    public string ProviderName => "stub";

    public Task<IReadOnlyList<CalendarEvent>?> GetEventsForDayAsync(DateOnly date, string ianaTimezone)
    {
        var tz = TimeZoneInfo.FindSystemTimeZoneById(ianaTimezone);
        var onDay = _events
            .Where(e => DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(e.StartTime, tz).DateTime) == date)
            .ToList();
        return Task.FromResult<IReadOnlyList<CalendarEvent>?>(onDay);
    }

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
