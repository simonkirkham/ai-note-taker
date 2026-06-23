using Api.Services;
using Microsoft.Extensions.Logging.Abstractions;

namespace Api.Integration;

public class StubCalendarClientTests
{
    private static StubCalendarClient Build(string json)
    {
        Environment.SetEnvironmentVariable("STUB_CALENDAR_JSON", json);
        try { return new StubCalendarClient(NullLogger<StubCalendarClient>.Instance); }
        finally { Environment.SetEnvironmentVariable("STUB_CALENDAR_JSON", null); }
    }

    [Fact]
    public async Task GetEventsForDayAsync_ReturnsOnlyEventsOnTheRequestedDay()
    {
        var json = """[{"calendarEventId":"e1","title":"Day one","startTime":"2026-01-01T09:00:00Z","endTime":"2026-01-01T09:30:00Z","isRecurring":false},{"calendarEventId":"e2","title":"Day two","startTime":"2026-01-02T09:00:00Z","endTime":"2026-01-02T09:30:00Z","isRecurring":false}]""";
        var client = Build(json);

        var result = await client.GetEventsForDayAsync(new DateOnly(2026, 1, 2), "UTC");

        Assert.NotNull(result);
        Assert.Single(result!);
        Assert.Equal("e2", result![0].CalendarEventId);
    }

    [Fact]
    public async Task GetEventsForDayAsync_ResolvesTheDayInTheCallersTimezone()
    {
        // 2026-01-02T02:00Z is still 2026-01-01 (21:00) in New York.
        var json = """[{"calendarEventId":"e1","title":"Late","startTime":"2026-01-02T02:00:00Z","endTime":"2026-01-02T02:30:00Z","isRecurring":false}]""";
        var client = Build(json);

        var result = await client.GetEventsForDayAsync(new DateOnly(2026, 1, 1), "America/New_York");

        Assert.NotNull(result);
        Assert.Single(result!);
        Assert.Equal("e1", result![0].CalendarEventId);
    }

    [Fact]
    public async Task GetNextOccurrenceAsync_ReturnsEarliestEventAfterCutoff()
    {
        var after = new DateTimeOffset(2026, 5, 20, 0, 0, 0, TimeSpan.Zero);
        var json = """[{"calendarEventId":"s1_a","title":"Weekly","startTime":"2026-05-27T09:00:00Z","endTime":"2026-05-27T09:30:00Z","isRecurring":true,"recurringSeriesId":"s1"},{"calendarEventId":"s1_b","title":"Weekly","startTime":"2026-06-03T09:00:00Z","endTime":"2026-06-03T09:30:00Z","isRecurring":true,"recurringSeriesId":"s1"}]""";
        var client = Build(json);

        var result = await client.GetNextOccurrenceAsync("s1", after);

        Assert.NotNull(result);
        Assert.Equal("s1_a", result!.CalendarEventId);
    }

    [Fact]
    public async Task GetNextOccurrenceAsync_ExcludesEventsAtOrBeforeCutoff()
    {
        var after = new DateTimeOffset(2026, 5, 27, 9, 0, 0, TimeSpan.Zero);
        var json = """[{"calendarEventId":"s1_a","title":"Weekly","startTime":"2026-05-27T09:00:00Z","endTime":"2026-05-27T09:30:00Z","isRecurring":true,"recurringSeriesId":"s1"},{"calendarEventId":"s1_b","title":"Weekly","startTime":"2026-06-03T09:00:00Z","endTime":"2026-06-03T09:30:00Z","isRecurring":true,"recurringSeriesId":"s1"}]""";
        var client = Build(json);

        var result = await client.GetNextOccurrenceAsync("s1", after);

        Assert.NotNull(result);
        Assert.Equal("s1_b", result!.CalendarEventId);
    }

    [Fact]
    public async Task GetNextOccurrenceAsync_ReturnsNull_WhenNoMatchingSeriesId()
    {
        var json = """[{"calendarEventId":"s1_a","title":"Weekly","startTime":"2026-05-27T09:00:00Z","endTime":"2026-05-27T09:30:00Z","isRecurring":true,"recurringSeriesId":"s1"}]""";
        var client = Build(json);

        var result = await client.GetNextOccurrenceAsync("other-series", DateTimeOffset.MinValue);

        Assert.Null(result);
    }

    [Fact]
    public async Task GetEventsForDayAsync_ReturnsEmpty_WhenJsonIsMalformed()
    {
        var client = Build("not valid json");

        var result = await client.GetEventsForDayAsync(new DateOnly(2026, 1, 1), "UTC");

        Assert.NotNull(result);
        Assert.Empty(result!);
    }
}
