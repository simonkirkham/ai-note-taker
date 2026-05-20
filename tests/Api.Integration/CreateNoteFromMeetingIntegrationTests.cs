using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Api.Services;
using Microsoft.Extensions.DependencyInjection;

namespace Api.Integration;

public sealed class CreateNoteFromMeetingIntegrationTests : IClassFixture<ApiFactory>
{
    private readonly HttpClient _client;
    private readonly HttpClient _unauthClient;
    private readonly FakeGoogleCalendarClient _fakeCalendar;

    public CreateNoteFromMeetingIntegrationTests(ApiFactory factory)
    {
        _client = factory.CreateClient();
        _unauthClient = factory.CreateUnauthenticatedClient();
        _fakeCalendar = factory.Services.GetRequiredService<FakeGoogleCalendarClient>();
        _fakeCalendar.Reset();
    }

    [Fact]
    public async Task PostNotesFromMeeting_CreatesAndLinksNote_Returns201WithNoteId()
    {
        var resp = await _client.PostAsJsonAsync("/notes/from-meeting", MeetingRequest("evt_9d_001"));

        Assert.Equal(HttpStatusCode.Created, resp.StatusCode);
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        var noteId = body.GetProperty("noteId").GetString();
        Assert.False(string.IsNullOrEmpty(noteId));
        Assert.True(Guid.TryParse(noteId, out _));
    }

    [Fact]
    public async Task PostNotesFromMeeting_NoteTitle_IsSetFromMeetingTitle()
    {
        var resp = await _client.PostAsJsonAsync("/notes/from-meeting", MeetingRequest("evt_9d_002", title: "1:1 with Sam"));
        resp.EnsureSuccessStatusCode();
        var noteId = (await resp.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("noteId").GetString()!;

        var detail = await _client.GetFromJsonAsync<JsonElement>($"/notes/{noteId}");
        Assert.Equal("1:1 with Sam", detail.GetProperty("title").GetString());
    }

    [Fact]
    public async Task PostNotesFromMeeting_NoteDate_IsSetToMeetingStartDate()
    {
        // startTime 2026-06-10T09:00:00Z → DateOnly 2026-06-10 (server runs in UTC)
        var resp = await _client.PostAsJsonAsync("/notes/from-meeting",
            MeetingRequest("evt_9d_003", startTime: "2026-06-10T09:00:00Z", endTime: "2026-06-10T09:30:00Z"));
        resp.EnsureSuccessStatusCode();
        var noteId = (await resp.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("noteId").GetString()!;

        var detail = await _client.GetFromJsonAsync<JsonElement>($"/notes/{noteId}");
        Assert.Equal("2026-06-10", detail.GetProperty("date").GetString());
    }

    [Fact]
    public async Task PostNotesFromMeeting_AlreadyLinked_Returns409()
    {
        await _client.PostAsJsonAsync("/notes/from-meeting", MeetingRequest("evt_9d_dup"));

        var resp = await _client.PostAsJsonAsync("/notes/from-meeting", MeetingRequest("evt_9d_dup"));
        Assert.Equal(HttpStatusCode.Conflict, resp.StatusCode);
    }

    [Fact]
    public async Task GetTodaysMeetings_AfterCreateFromMeeting_ReturnsLinkedNoteId()
    {
        var createResp = await _client.PostAsJsonAsync("/notes/from-meeting", MeetingRequest("evt_9d_linked"));
        createResp.EnsureSuccessStatusCode();
        var noteId = (await createResp.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("noteId").GetString()!;

        _fakeCalendar.SetEvents(new[]
        {
            new CalendarEvent("evt_9d_linked", "Design Review", DateTimeOffset.UtcNow, DateTimeOffset.UtcNow.AddMinutes(60), false, null)
        });

        var todayResp = await _client.GetAsync("/calendar/today?tz=UTC");
        todayResp.EnsureSuccessStatusCode();
        var body = await todayResp.Content.ReadFromJsonAsync<JsonElement>();
        var meeting = body.GetProperty("meetings")[0];

        Assert.Equal(noteId, meeting.GetProperty("linkedNoteId").GetString());
    }

    [Fact]
    public async Task PostNotesFromMeeting_RequiresAuth_Returns401()
    {
        var resp = await _unauthClient.PostAsJsonAsync("/notes/from-meeting", MeetingRequest("evt_9d_unauth"));
        Assert.Equal(HttpStatusCode.Unauthorized, resp.StatusCode);
    }

    private static object MeetingRequest(
        string calendarEventId,
        string title = "Team Standup",
        string startTime = "2026-05-14T09:00:00Z",
        string endTime = "2026-05-14T09:30:00Z",
        bool isRecurring = false,
        string? recurringSeriesId = null) => new
    {
        calendarEventId,
        title,
        startTime,
        endTime,
        isRecurring,
        recurringSeriesId
    };
}
