using Api.Services;
using Microsoft.Extensions.Logging.Abstractions;

namespace Api.Integration;

public class StubGoogleCalendarClientTests
{
    private static StubGoogleCalendarClient Build(string json)
    {
        Environment.SetEnvironmentVariable("STUB_CALENDAR_JSON", json);
        try { return new StubGoogleCalendarClient(NullLogger<StubGoogleCalendarClient>.Instance); }
        finally { Environment.SetEnvironmentVariable("STUB_CALENDAR_JSON", null); }
    }

    [Fact]
    public async Task GetTodaysEventsAsync_ReturnsAllEvents_RegardlessOfDate()
    {
        var json = """[{"calendarEventId":"e1","title":"Past","startTime":"2020-01-01T09:00:00Z","endTime":"2020-01-01T09:30:00Z","isRecurring":false},{"calendarEventId":"e2","title":"Future","startTime":"2030-01-01T09:00:00Z","endTime":"2030-01-01T09:30:00Z","isRecurring":false}]""";
        var client = Build(json);

        var result = await client.GetTodaysEventsAsync("America/New_York");

        Assert.NotNull(result);
        Assert.Equal(2, result!.Count);
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
    public async Task GetTodaysEventsAsync_ReturnsEmpty_WhenJsonIsMalformed()
    {
        var client = Build("not valid json");

        var result = await client.GetTodaysEventsAsync("UTC");

        Assert.NotNull(result);
        Assert.Empty(result!);
    }
}
