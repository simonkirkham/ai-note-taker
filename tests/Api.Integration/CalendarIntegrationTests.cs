using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Api.Services;
using Microsoft.Extensions.DependencyInjection;

namespace Api.Integration;

public sealed class CalendarIntegrationTests : IClassFixture<ApiFactory>
{
    private readonly HttpClient _client;
    private readonly HttpClient _unauthClient;
    private readonly FakeGoogleCalendarClient _fake;

    private static string Today => DateOnly.FromDateTime(DateTime.UtcNow).ToString("yyyy-MM-dd");

    public CalendarIntegrationTests(ApiFactory factory)
    {
        _client = factory.CreateClient();
        _unauthClient = factory.CreateUnauthenticatedClient();
        _fake = factory.Services.GetRequiredService<FakeGoogleCalendarClient>();
        _fake.Reset();
    }

    [Fact]
    public async Task GetMeetingsForDate_ReturnsMeetingsShape()
    {
        var now = DateTimeOffset.UtcNow;
        _fake.SetEvents(new[]
        {
            new CalendarEvent("evt1", "1:1 with Bill", now, now.AddMinutes(30), false, null)
        });

        var resp = await _client.GetAsync($"/calendar/{Today}?tz=UTC");

        resp.EnsureSuccessStatusCode();
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(body.TryGetProperty("meetings", out var meetings));
        Assert.Equal(1, meetings.GetArrayLength());
        var meeting = meetings[0];
        Assert.Equal("evt1", meeting.GetProperty("calendarEventId").GetString());
        Assert.Equal("1:1 with Bill", meeting.GetProperty("title").GetString());
        Assert.Equal(JsonValueKind.Null, meeting.GetProperty("linkedNoteId").ValueKind);
        Assert.False(meeting.GetProperty("hasNextOccurrenceNote").GetBoolean());
    }

    [Fact]
    public async Task GetMeetingsForDate_ForwardsThePathDateToTheCalendarClient()
    {
        var resp = await _client.GetAsync("/calendar/2026-06-08?tz=UTC");

        resp.EnsureSuccessStatusCode();
        Assert.Equal(new DateOnly(2026, 6, 8), _fake.LastRequestedDate);
    }

    [Fact]
    public async Task GetMeetingsForDate_OrderedByStartTime()
    {
        var base_ = DateTimeOffset.UtcNow.Date;
        _fake.SetEvents(new[]
        {
            new CalendarEvent("evt2", "Afternoon", new DateTimeOffset(base_.AddHours(14), TimeSpan.Zero), new DateTimeOffset(base_.AddHours(15), TimeSpan.Zero), false, null),
            new CalendarEvent("evt1", "Morning", new DateTimeOffset(base_.AddHours(9), TimeSpan.Zero), new DateTimeOffset(base_.AddHours(10), TimeSpan.Zero), false, null),
        });

        var resp = await _client.GetAsync($"/calendar/{Today}?tz=UTC");

        resp.EnsureSuccessStatusCode();
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        var meetings = body.GetProperty("meetings");
        Assert.Equal("Morning", meetings[0].GetProperty("title").GetString());
        Assert.Equal("Afternoon", meetings[1].GetProperty("title").GetString());
    }

    [Fact]
    public async Task GetMeetingsForDate_WhenCalendarUnavailable_ReturnsErrorBody()
    {
        _fake.SetUnavailable();

        var resp = await _client.GetAsync($"/calendar/{Today}?tz=UTC");

        resp.EnsureSuccessStatusCode();
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("calendar_unavailable", body.GetProperty("error").GetString());
    }

    [Fact]
    public async Task GetMeetingsForDate_MissingTz_Returns400()
    {
        var resp = await _client.GetAsync($"/calendar/{Today}");

        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
    }

    [Fact]
    public async Task GetMeetingsForDate_InvalidTimezone_Returns400()
    {
        var resp = await _client.GetAsync($"/calendar/{Today}?tz=Not%2FATimezone");

        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("invalid_timezone", body.GetProperty("error").GetString());
    }

    [Fact]
    public async Task GetMeetingsForDate_MalformedDate_Returns400InvalidDate()
    {
        var resp = await _client.GetAsync("/calendar/08-06-2026?tz=UTC");

        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("invalid_date", body.GetProperty("error").GetString());
    }

    [Fact]
    public async Task GetMeetingsForDate_Unauthenticated_Returns401()
    {
        var resp = await _unauthClient.GetAsync($"/calendar/{Today}?tz=UTC");

        Assert.Equal(HttpStatusCode.Unauthorized, resp.StatusCode);
    }
}
