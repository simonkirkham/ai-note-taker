using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Api.Services;
using Microsoft.Extensions.DependencyInjection;

namespace Api.Integration;

public sealed class RecurringNextOccurrenceTests : IClassFixture<ApiFactory>
{
    private readonly HttpClient _client;
    private readonly FakeGoogleCalendarClient _fakeCalendar;

    public RecurringNextOccurrenceTests(ApiFactory factory)
    {
        _client = factory.CreateClient();
        _fakeCalendar = factory.Services.GetRequiredService<FakeGoogleCalendarClient>();
        _fakeCalendar.Reset();
    }

    [Fact]
    public async Task CreateNoteFromNextOccurrence_CreatesAndLinksNote()
    {
        var nextOccurrence = new CalendarEvent(
            "series1_20260527T090000Z",
            "Weekly Sync",
            new DateTimeOffset(2026, 5, 27, 9, 0, 0, TimeSpan.Zero),
            new DateTimeOffset(2026, 5, 27, 9, 30, 0, TimeSpan.Zero),
            true,
            "series1");
        _fakeCalendar.SetNextOccurrence("series1", nextOccurrence);

        var resp = await _client.PostAsJsonAsync("/notes/from-next-occurrence", new
        {
            recurringSeriesId = "series1",
            todayCalendarEventId = "series1_20260520T090000Z"
        });

        Assert.Equal(HttpStatusCode.Created, resp.StatusCode);
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(body.TryGetProperty("noteId", out var noteIdProp));
        Assert.False(string.IsNullOrEmpty(noteIdProp.GetString()));
        Assert.True(body.TryGetProperty("nextOccurrence", out _));
    }

    [Fact]
    public async Task CreateNoteFromNextOccurrence_NoFutureOccurrences_Returns404()
    {
        _fakeCalendar.SetNextOccurrence("ended-series", null);

        var resp = await _client.PostAsJsonAsync("/notes/from-next-occurrence", new
        {
            recurringSeriesId = "ended-series",
            todayCalendarEventId = "ended-series_20260520T090000Z"
        });

        Assert.Equal(HttpStatusCode.NotFound, resp.StatusCode);
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("no_future_occurrences", body.GetProperty("error").GetString());
    }

    [Fact]
    public async Task CreateNoteFromNextOccurrence_NoteAlreadyExists_ReturnsAlreadyExists()
    {
        var nextEvent = new CalendarEvent(
            "series2_20260527T090000Z",
            "Design Review",
            new DateTimeOffset(2026, 5, 27, 14, 0, 0, TimeSpan.Zero),
            new DateTimeOffset(2026, 5, 27, 14, 30, 0, TimeSpan.Zero),
            true,
            "series2");
        _fakeCalendar.SetNextOccurrence("series2", nextEvent);

        // Create a note for that occurrence first
        var firstResp = await _client.PostAsJsonAsync("/notes/from-next-occurrence", new
        {
            recurringSeriesId = "series2",
            todayCalendarEventId = "series2_20260520T090000Z"
        });
        Assert.Equal(HttpStatusCode.Created, firstResp.StatusCode);
        var firstBody = await firstResp.Content.ReadFromJsonAsync<JsonElement>();
        var existingNoteId = firstBody.GetProperty("noteId").GetString()!;

        // Call again — should get alreadyExists
        var secondResp = await _client.PostAsJsonAsync("/notes/from-next-occurrence", new
        {
            recurringSeriesId = "series2",
            todayCalendarEventId = "series2_20260520T090000Z"
        });

        Assert.Equal(HttpStatusCode.OK, secondResp.StatusCode);
        var secondBody = await secondResp.Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(secondBody.GetProperty("alreadyExists").GetBoolean());
        Assert.Equal(existingNoteId, secondBody.GetProperty("noteId").GetString());
    }

    [Fact]
    public async Task GetTodaysMeetings_HasNextOccurrenceNote_ReturnsTrue()
    {
        var todayEvent = new CalendarEvent(
            "series3_20260520T090000Z",
            "Standup",
            DateTimeOffset.UtcNow,
            DateTimeOffset.UtcNow.AddMinutes(15),
            true,
            "series3");
        var nextEvent = new CalendarEvent(
            "series3_20260527T090000Z",
            "Standup",
            new DateTimeOffset(2026, 5, 27, 9, 0, 0, TimeSpan.Zero),
            new DateTimeOffset(2026, 5, 27, 9, 15, 0, TimeSpan.Zero),
            true,
            "series3");

        _fakeCalendar.SetEvents(new[] { todayEvent });
        _fakeCalendar.SetNextOccurrence("series3", nextEvent);

        // Create a note for the next occurrence
        await _client.PostAsJsonAsync("/notes/from-next-occurrence", new
        {
            recurringSeriesId = "series3",
            todayCalendarEventId = todayEvent.CalendarEventId
        });

        var resp = await _client.GetAsync("/calendar/today?tz=UTC");
        resp.EnsureSuccessStatusCode();
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        var meeting = body.GetProperty("meetings")[0];

        Assert.True(meeting.GetProperty("hasNextOccurrenceNote").GetBoolean());
    }

    [Fact]
    public async Task GetTodaysMeetings_NoNextOccurrenceNote_ReturnsFalse()
    {
        var todayEvent = new CalendarEvent(
            "series4_20260520T090000Z",
            "Weekly Retro",
            DateTimeOffset.UtcNow,
            DateTimeOffset.UtcNow.AddHours(1),
            true,
            "series4");
        _fakeCalendar.SetEvents(new[] { todayEvent });

        var resp = await _client.GetAsync("/calendar/today?tz=UTC");
        resp.EnsureSuccessStatusCode();
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        var meeting = body.GetProperty("meetings")[0];

        Assert.False(meeting.GetProperty("hasNextOccurrenceNote").GetBoolean());
    }
}
