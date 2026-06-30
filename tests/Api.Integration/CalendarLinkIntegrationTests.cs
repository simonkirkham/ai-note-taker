using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Api.Services;
using Microsoft.Extensions.DependencyInjection;

namespace Api.Integration;

[Collection("ProjectionRebuild")]
public sealed class CalendarLinkIntegrationTests : IClassFixture<ApiFactory>
{
    private readonly HttpClient _client;
    private readonly FakeCalendarClient _fakeCalendar;

    public CalendarLinkIntegrationTests(ApiFactory factory)
    {
        _client = factory.CreateClient();
        _fakeCalendar = factory.Services.GetRequiredService<FakeCalendarClient>();
        _fakeCalendar.Reset();
    }

    [Fact]
    public async Task PostCalendarLink_LinksNote_Returns204()
    {
        var noteId = await CreateNoteAsync();

        var resp = await _client.PostAsJsonAsync($"/notes/{noteId}/calendar-link", new
        {
            calendarEventId = "evt_abc123",
            calendarEventTitle = "1:1 with Bill",
            startTime = "2026-05-14T09:00:00Z",
            endTime = "2026-05-14T09:30:00Z",
            isRecurring = false,
            recurringSeriesId = (string?)null
        });

        Assert.Equal(HttpStatusCode.NoContent, resp.StatusCode);
    }

    [Fact]
    public async Task PostCalendarLink_Relink_MovesNoteToNewMeeting()
    {
        var noteId = await CreateNoteAsync();
        await LinkNoteAsync(noteId, "evt_old");

        var resp = await _client.PostAsJsonAsync($"/notes/{noteId}/calendar-link", new
        {
            calendarEventId = "evt_new",
            calendarEventTitle = "Budget review",
            startTime = "2026-05-14T10:00:00Z",
            endTime = "2026-05-14T10:30:00Z",
            isRecurring = false,
            recurringSeriesId = (string?)null
        });

        Assert.Equal(HttpStatusCode.NoContent, resp.StatusCode);

        var note = await (await _client.GetAsync($"/notes/{noteId}")).Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("evt_new", note.GetProperty("linkedMeeting").GetProperty("calendarEventId").GetString());
    }

    [Fact]
    public async Task PostCalendarLink_Relink_FreesTheOldMeetingAndClaimsTheNew()
    {
        var noteId = await CreateNoteAsync();
        await LinkNoteAsync(noteId, "evt_old");
        await LinkNoteAsync(noteId, "evt_new");

        _fakeCalendar.SetEvents(new[]
        {
            new CalendarEvent("evt_old", "Old Meeting", DateTimeOffset.UtcNow, DateTimeOffset.UtcNow.AddMinutes(30), false, null),
            new CalendarEvent("evt_new", "New Meeting", DateTimeOffset.UtcNow.AddHours(1), DateTimeOffset.UtcNow.AddHours(2), false, null)
        });

        var body = await (await _client.GetAsync($"/calendar/{DateOnly.FromDateTime(DateTime.UtcNow):yyyy-MM-dd}?tz=UTC")).Content.ReadFromJsonAsync<JsonElement>();
        var meetings = body.GetProperty("meetings");
        var old = meetings.EnumerateArray().First(m => m.GetProperty("calendarEventId").GetString() == "evt_old");
        var @new = meetings.EnumerateArray().First(m => m.GetProperty("calendarEventId").GetString() == "evt_new");

        Assert.Equal(JsonValueKind.Null, old.GetProperty("linkedNoteId").ValueKind);
        Assert.Equal(noteId.ToString(), @new.GetProperty("linkedNoteId").GetString());
    }

    [Fact]
    public async Task PostCalendarLink_RelinkToSameMeeting_IsIdempotent()
    {
        var noteId = await CreateNoteAsync();
        await LinkNoteAsync(noteId, "evt_abc123");

        var resp = await _client.PostAsJsonAsync($"/notes/{noteId}/calendar-link", new
        {
            calendarEventId = "evt_abc123",
            calendarEventTitle = "1:1 with Bill",
            startTime = "2026-05-14T09:00:00Z",
            endTime = "2026-05-14T09:30:00Z",
            isRecurring = false,
            recurringSeriesId = (string?)null
        });

        Assert.Equal(HttpStatusCode.NoContent, resp.StatusCode);
        var note = await (await _client.GetAsync($"/notes/{noteId}")).Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("evt_abc123", note.GetProperty("linkedMeeting").GetProperty("calendarEventId").GetString());
    }

    [Fact]
    public async Task PostCalendarLink_RelinkAcrossSeries_UpdatesSeriesLink()
    {
        var noteId = await CreateNoteAsync();
        await LinkNoteAsync(noteId, "evt_occurrence_1", recurringSeriesId: "series_42", isRecurring: true);
        await LinkNoteAsync(noteId, "evt_occurrence_9", recurringSeriesId: "series_99", isRecurring: true);

        var note = await (await _client.GetAsync($"/notes/{noteId}")).Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("evt_occurrence_9", note.GetProperty("linkedMeeting").GetProperty("calendarEventId").GetString());
        Assert.Equal("series_99", note.GetProperty("recurringSeriesId").GetString());
    }

    [Fact]
    public async Task PostCalendarLink_DeletedNote_Returns409()
    {
        var noteId = await CreateNoteAsync();
        await _client.DeleteAsync($"/notes/{noteId}");

        var resp = await _client.PostAsJsonAsync($"/notes/{noteId}/calendar-link", new
        {
            calendarEventId = "evt_abc123",
            calendarEventTitle = "1:1 with Bill",
            startTime = "2026-05-14T09:00:00Z",
            endTime = "2026-05-14T09:30:00Z",
            isRecurring = false,
            recurringSeriesId = (string?)null
        });

        Assert.Equal(HttpStatusCode.Conflict, resp.StatusCode);
    }

    [Fact]
    public async Task PostCalendarLink_UnknownNote_Returns404()
    {
        var resp = await _client.PostAsJsonAsync($"/notes/{Guid.NewGuid()}/calendar-link", new
        {
            calendarEventId = "evt_abc123",
            calendarEventTitle = "1:1 with Bill",
            startTime = "2026-05-14T09:00:00Z",
            endTime = "2026-05-14T09:30:00Z",
            isRecurring = false,
            recurringSeriesId = (string?)null
        });

        Assert.Equal(HttpStatusCode.NotFound, resp.StatusCode);
    }

    [Fact]
    public async Task GetTodaysMeetings_ReturnsLinkedNoteId()
    {
        var noteId = await CreateNoteAsync();
        await LinkNoteAsync(noteId, "evt_linked");

        _fakeCalendar.SetEvents(new[]
        {
            new CalendarEvent("evt_linked", "Linked Meeting", DateTimeOffset.UtcNow, DateTimeOffset.UtcNow.AddMinutes(30), false, null),
            new CalendarEvent("evt_unlinked", "Unlinked Meeting", DateTimeOffset.UtcNow.AddHours(1), DateTimeOffset.UtcNow.AddHours(2), false, null)
        });

        var resp = await _client.GetAsync($"/calendar/{DateOnly.FromDateTime(DateTime.UtcNow):yyyy-MM-dd}?tz=UTC");

        resp.EnsureSuccessStatusCode();
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        var meetings = body.GetProperty("meetings");

        var linked = meetings.EnumerateArray().First(m => m.GetProperty("calendarEventId").GetString() == "evt_linked");
        var unlinked = meetings.EnumerateArray().First(m => m.GetProperty("calendarEventId").GetString() == "evt_unlinked");

        Assert.Equal(noteId.ToString(), linked.GetProperty("linkedNoteId").GetString());
        Assert.Equal(JsonValueKind.Null, unlinked.GetProperty("linkedNoteId").ValueKind);
    }

    [Fact]
    public async Task DeleteNote_RemovesFromCalendarLinkIndex()
    {
        var noteId = await CreateNoteAsync();
        await LinkNoteAsync(noteId, "evt_to_delete");

        await _client.DeleteAsync($"/notes/{noteId}");

        _fakeCalendar.SetEvents(new[]
        {
            new CalendarEvent("evt_to_delete", "Will Be Gone", DateTimeOffset.UtcNow, DateTimeOffset.UtcNow.AddMinutes(30), false, null)
        });

        var resp = await _client.GetAsync($"/calendar/{DateOnly.FromDateTime(DateTime.UtcNow):yyyy-MM-dd}?tz=UTC");
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        var meeting = body.GetProperty("meetings")[0];

        Assert.Equal(JsonValueKind.Null, meeting.GetProperty("linkedNoteId").ValueKind);
    }

    [Fact]
    public async Task GetNote_RecurringLinkedNote_ExposesSeriesLink()
    {
        var noteId = await CreateNoteAsync();
        await LinkNoteAsync(noteId, "evt_recurring", recurringSeriesId: "series_42", isRecurring: true);

        var resp = await _client.GetAsync($"/notes/{noteId}");

        resp.EnsureSuccessStatusCode();
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("series_42", body.GetProperty("recurringSeriesId").GetString());
        Assert.True(body.GetProperty("isRecurring").GetBoolean());
    }

    [Fact]
    public async Task GetNote_NonRecurringLinkedNote_HasNoSeriesLink()
    {
        var noteId = await CreateNoteAsync();
        await LinkNoteAsync(noteId, "evt_one_off");

        var resp = await _client.GetAsync($"/notes/{noteId}");

        resp.EnsureSuccessStatusCode();
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(JsonValueKind.Null, body.GetProperty("recurringSeriesId").ValueKind);
        Assert.False(body.GetProperty("isRecurring").GetBoolean());
    }

    [Fact]
    public async Task GetNote_PlainNote_HasNoSeriesLink()
    {
        var noteId = await CreateNoteAsync();

        var resp = await _client.GetAsync($"/notes/{noteId}");

        resp.EnsureSuccessStatusCode();
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(JsonValueKind.Null, body.GetProperty("recurringSeriesId").ValueKind);
        Assert.False(body.GetProperty("isRecurring").GetBoolean());
    }

    [Fact]
    public async Task GetNote_NonRecurringLinkedNote_ReturnsLinkedMeeting()
    {
        var noteId = await CreateNoteAsync();
        await LinkNoteAsync(noteId, "evt_one_off");

        var resp = await _client.GetAsync($"/notes/{noteId}");

        resp.EnsureSuccessStatusCode();
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        var linked = body.GetProperty("linkedMeeting");
        Assert.Equal(JsonValueKind.Object, linked.ValueKind);
        Assert.Equal("evt_one_off", linked.GetProperty("calendarEventId").GetString());
        Assert.Equal("Test Meeting", linked.GetProperty("title").GetString());
        Assert.Equal(DateTimeOffset.Parse("2026-05-14T09:00:00Z"), linked.GetProperty("startTime").GetDateTimeOffset());
        Assert.Equal(DateTimeOffset.Parse("2026-05-14T09:30:00Z"), linked.GetProperty("endTime").GetDateTimeOffset());
        Assert.Equal(JsonValueKind.Null, linked.GetProperty("recurringSeriesId").ValueKind);
        Assert.False(linked.GetProperty("isRecurring").GetBoolean());
    }

    [Fact]
    public async Task GetNote_RecurringLinkedNote_LinkedMeetingHasSeries()
    {
        var noteId = await CreateNoteAsync();
        await LinkNoteAsync(noteId, "evt_recurring", recurringSeriesId: "series_42", isRecurring: true);

        var resp = await _client.GetAsync($"/notes/{noteId}");

        resp.EnsureSuccessStatusCode();
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        var linked = body.GetProperty("linkedMeeting");
        Assert.Equal("series_42", linked.GetProperty("recurringSeriesId").GetString());
        Assert.True(linked.GetProperty("isRecurring").GetBoolean());
    }

    [Fact]
    public async Task GetNote_PlainNote_LinkedMeetingIsNull()
    {
        var noteId = await CreateNoteAsync();

        var resp = await _client.GetAsync($"/notes/{noteId}");

        resp.EnsureSuccessStatusCode();
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(JsonValueKind.Null, body.GetProperty("linkedMeeting").ValueKind);
    }

    [Fact]
    public async Task RebuildProjections_ReconstructsCalendarLinkFromEvents()
    {
        var noteId = await CreateNoteAsync();
        await LinkNoteAsync(noteId, "evt_rebuilt");

        var rebuild = await _client.PostAsync("/admin/projections/rebuild", null);
        rebuild.EnsureSuccessStatusCode();

        var resp = await _client.GetAsync($"/notes/{noteId}");
        resp.EnsureSuccessStatusCode();
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        var linked = body.GetProperty("linkedMeeting");
        Assert.Equal(JsonValueKind.Object, linked.ValueKind);
        Assert.Equal("evt_rebuilt", linked.GetProperty("calendarEventId").GetString());
        Assert.Equal("Test Meeting", linked.GetProperty("title").GetString());
    }

    private async Task<Guid> CreateNoteAsync()
    {
        var resp = await _client.PostAsync("/notes", null);
        resp.EnsureSuccessStatusCode();
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        return Guid.Parse(body.GetProperty("noteId").GetString()!);
    }

    private async Task LinkNoteAsync(Guid noteId, string calendarEventId, string? recurringSeriesId = null, bool isRecurring = false)
    {
        var resp = await _client.PostAsJsonAsync($"/notes/{noteId}/calendar-link", new
        {
            calendarEventId,
            calendarEventTitle = "Test Meeting",
            startTime = "2026-05-14T09:00:00Z",
            endTime = "2026-05-14T09:30:00Z",
            isRecurring,
            recurringSeriesId
        });
        resp.EnsureSuccessStatusCode();
    }
}
