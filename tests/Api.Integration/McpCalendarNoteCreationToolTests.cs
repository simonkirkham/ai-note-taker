using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using Api.Services;
using Domain.Notes;
using Domain.Workspaces;
using EventStore.Projections;
using Microsoft.Extensions.DependencyInjection;

namespace Api.Integration;

// 42-B: create_note_from_meeting + create_note_from_next_occurrence write tools over MCP. They mirror
// the HTTP CalendarHandlers (CreateNoteFromMeeting / CreateNoteFromNextOccurrence) but resolve identity
// from the token sub + workspaceId argument (the 42-A ICalendarScope pattern), not the route. The note
// is created, dated, and linked through the existing NoteCommands; the result is verified against the
// inline-updated NoteDetail + CalendarLinkIndex projections (Api.Integration runs a single in-process
// host, so the projections are populated synchronously when the tool returns).
public sealed class McpCalendarNoteCreationToolTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private const string ProtocolVersion = "2025-06-18";
    private const string Owner = "test-user-123";        // allowlisted sub (FakeCurrentUser.TestUserId)
    private const string OtherUser = "other-user-456";   // also allowlisted, owns nothing here

    private readonly ApiFactory _factory = factory;

    private FakeCalendarClient Calendar => _factory.Services.GetRequiredService<FakeCalendarClient>();
    private INoteDetailStore Notes => _factory.Services.GetRequiredService<INoteDetailStore>();
    private ICalendarLinkIndexStore Links => _factory.Services.GetRequiredService<ICalendarLinkIndexStore>();

    [Fact]
    public async Task ToolsList_IncludesBothCreationTools()
    {
        var client = _factory.CreateUnauthenticatedClient();
        var names = (await CallAsync(client, "tools/list", new { }, McpTestTokens.Valid()))
            .GetProperty("tools").EnumerateArray().Select(t => t.GetProperty("name").GetString()).ToList();
        Assert.Contains("create_note_from_meeting", names);
        Assert.Contains("create_note_from_next_occurrence", names);
    }

    [Fact]
    public async Task CreateNoteFromMeeting_CreatesDatesAndLinksNote()
    {
        var client = _factory.CreateUnauthenticatedClient();
        var result = await CallToolAsync(client, "create_note_from_meeting", new
        {
            workspaceId = WorkspaceId.DefaultValue,
            calendarEventId = "evt-42b-1",
            title = "Acme standup",
            startTime = "2026-07-06T09:00:00Z",
            endTime = "2026-07-06T09:30:00Z",
            isRecurring = true,
            recurringSeriesId = "series-acme"
        }, McpTestTokens.Valid(Owner));

        Assert.False(IsToolError(result));
        var payload = ParsePayload(result);
        Assert.False(payload.GetProperty("alreadyExists").GetBoolean());
        var noteId = payload.GetProperty("noteId").GetString()!;
        Assert.True(Guid.TryParse(noteId, out var guid));

        var detail = await Notes.GetAsync(new NoteId(guid));
        Assert.NotNull(detail);
        Assert.Equal("Acme standup", detail!.Title);
        Assert.Equal(new DateOnly(2026, 7, 6), detail.Date);

        var link = await Links.GetByCalendarEventIdAsync("evt-42b-1");
        Assert.NotNull(link);
        Assert.Equal(noteId, link!.NoteId);
        Assert.Equal(Owner, link.UserId);
        Assert.Equal("series-acme", link.RecurringSeriesId);
    }

    [Fact]
    public async Task CreateNoteFromMeeting_WhenAlreadyLinked_ReportsExistingNote_NoDuplicate()
    {
        var client = _factory.CreateUnauthenticatedClient();
        var args = new
        {
            workspaceId = WorkspaceId.DefaultValue,
            calendarEventId = "evt-42b-dup",
            title = "Weekly sync",
            startTime = "2026-07-07T10:00:00Z",
            endTime = "2026-07-07T10:30:00Z",
            isRecurring = false,
            recurringSeriesId = (string?)null
        };

        var first = ParsePayload(await CallToolAsync(client, "create_note_from_meeting", args, McpTestTokens.Valid(Owner)));
        var firstNoteId = first.GetProperty("noteId").GetString()!;

        var secondResult = await CallToolAsync(client, "create_note_from_meeting", args, McpTestTokens.Valid(Owner));
        Assert.False(IsToolError(secondResult));
        var second = ParsePayload(secondResult);

        Assert.True(second.GetProperty("alreadyExists").GetBoolean());
        Assert.Equal(firstNoteId, second.GetProperty("noteId").GetString());

        // The link still points at the original note — no second note was created for the event.
        var link = await Links.GetByCalendarEventIdAsync("evt-42b-dup");
        Assert.Equal(firstNoteId, link!.NoteId);
    }

    [Fact]
    public async Task CreateNoteFromMeeting_DifferentUser_SameEvent_IsNotBlockedByAnothersLink()
    {
        // Per-sub conflict scoping: Owner linking an event must not block OtherUser from creating
        // their OWN note for the same event (mirrors the HTTP DifferentUser_SameEventId test). Both
        // call the shared default workspace, which every allowlisted sub owns.
        var client = _factory.CreateUnauthenticatedClient();
        object Args(string id) => new
        {
            workspaceId = WorkspaceId.DefaultValue,
            calendarEventId = id,
            title = "Shared meeting",
            startTime = "2026-07-09T09:00:00Z",
            endTime = "2026-07-09T09:30:00Z"
        };

        var ownerResult = ParsePayload(await CallToolAsync(client, "create_note_from_meeting", Args("evt-42b-shared"), McpTestTokens.Valid(Owner)));
        var ownerNoteId = ownerResult.GetProperty("noteId").GetString()!;

        var otherResult = await CallToolAsync(client, "create_note_from_meeting", Args("evt-42b-shared"), McpTestTokens.Valid(OtherUser));
        Assert.False(IsToolError(otherResult));
        var other = ParsePayload(otherResult);
        // OtherUser's call proceeds (not reported as an existing-note duplicate of Owner's).
        Assert.False(other.GetProperty("alreadyExists").GetBoolean());
        Assert.NotEqual(ownerNoteId, other.GetProperty("noteId").GetString());
    }

    [Fact]
    public async Task CreateNoteFromMeeting_ForUnownedWorkspace_IsRejected()
    {
        SeedWorkspace(Owner, "ws-private-meeting", "Private");
        var client = _factory.CreateUnauthenticatedClient();

        var result = await CallToolAsync(client, "create_note_from_meeting", new
        {
            workspaceId = "ws-private-meeting",
            calendarEventId = "evt-42b-denied",
            title = "Secret",
            startTime = "2026-07-08T09:00:00Z",
            endTime = "2026-07-08T09:30:00Z"
        }, McpTestTokens.Valid(OtherUser));

        Assert.True(IsToolError(result));
        Assert.Null(await Links.GetByCalendarEventIdAsync("evt-42b-denied"));
    }

    [Fact]
    public async Task CreateNoteFromNextOccurrence_LinksTheNextFutureOccurrence()
    {
        Calendar.Reset();
        Calendar.SetNextOccurrence("series-weekly", new CalendarEvent("evt-42b-next", "Weekly review",
            new DateTimeOffset(2026, 7, 13, 14, 0, 0, TimeSpan.Zero),
            new DateTimeOffset(2026, 7, 13, 15, 0, 0, TimeSpan.Zero), true, "series-weekly"));

        var client = _factory.CreateUnauthenticatedClient();
        var result = await CallToolAsync(client, "create_note_from_next_occurrence",
            new { workspaceId = WorkspaceId.DefaultValue, recurringSeriesId = "series-weekly" }, McpTestTokens.Valid(Owner));

        Assert.False(IsToolError(result));
        var payload = ParsePayload(result);
        Assert.False(payload.GetProperty("alreadyExists").GetBoolean());
        var noteId = payload.GetProperty("noteId").GetString()!;
        Assert.Equal("evt-42b-next", payload.GetProperty("calendarEventId").GetString());

        var detail = await Notes.GetAsync(new NoteId(Guid.Parse(noteId)));
        Assert.Equal("Weekly review", detail!.Title);
        Assert.Equal(new DateOnly(2026, 7, 13), detail.Date);

        var link = await Links.GetByCalendarEventIdAsync("evt-42b-next");
        Assert.Equal(noteId, link!.NoteId);
        Assert.Equal(Owner, link.UserId);
    }

    [Fact]
    public async Task CreateNoteFromNextOccurrence_WhenNoFutureOccurrence_ReturnsCleanResult_NotAnError()
    {
        Calendar.Reset();
        Calendar.SetNextOccurrence("series-ended", null);

        var client = _factory.CreateUnauthenticatedClient();
        var result = await CallToolAsync(client, "create_note_from_next_occurrence",
            new { workspaceId = WorkspaceId.DefaultValue, recurringSeriesId = "series-ended" }, McpTestTokens.Valid(Owner));

        Assert.False(IsToolError(result));
        var payload = ParsePayload(result);
        Assert.True(payload.GetProperty("noFutureOccurrence").GetBoolean());
    }

    [Fact]
    public async Task CreateNoteFromNextOccurrence_ForUnownedWorkspace_IsRejected()
    {
        SeedWorkspace(Owner, "ws-private-next", "Private");
        var client = _factory.CreateUnauthenticatedClient();

        var result = await CallToolAsync(client, "create_note_from_next_occurrence",
            new { workspaceId = "ws-private-next", recurringSeriesId = "series-x" }, McpTestTokens.Valid(OtherUser));

        Assert.True(IsToolError(result));
    }

    // ── Helpers ──────────────────────────────────────────────────────────

    private void SeedWorkspace(string userId, string workspaceId, string name)
    {
        var store = _factory.Services.GetRequiredService<IWorkspaceListStore>();
        store.UpsertAsync(new WorkspaceListView(
            new WorkspaceId(workspaceId), name, DateTimeOffset.UtcNow, userId)).GetAwaiter().GetResult();
    }

    private static JsonElement ParsePayload(JsonElement toolResult)
    {
        using var doc = JsonDocument.Parse(RawText(toolResult));
        return doc.RootElement.Clone();
    }

    private static string RawText(JsonElement toolResult) =>
        toolResult.GetProperty("content").EnumerateArray()
            .First(c => c.GetProperty("type").GetString() == "text")
            .GetProperty("text").GetString()!;

    private static bool IsToolError(JsonElement toolResult) =>
        toolResult.TryGetProperty("isError", out var e) && e.ValueKind == JsonValueKind.True;

    private async Task<JsonElement> CallToolAsync(HttpClient client, string toolName, object arguments, string token) =>
        await CallAsync(client, "tools/call", new { name = toolName, arguments }, token);

    private async Task<JsonElement> CallAsync(HttpClient client, string method, object @params, string token)
    {
        await PostAsync(client, Envelope("initialize", InitializeParams()), token);
        var resp = await PostAsync(client, Envelope(method, @params), token);
        resp.EnsureSuccessStatusCode();
        return await ReadResultAsync(resp);
    }

    private static async Task<HttpResponseMessage> PostAsync(HttpClient client, string json, string bearer)
    {
        var req = new HttpRequestMessage(HttpMethod.Post, "/mcp")
        {
            Content = new StringContent(json, Encoding.UTF8, "application/json")
        };
        req.Headers.Add("MCP-Protocol-Version", ProtocolVersion);
        req.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        req.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("text/event-stream"));
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", bearer);
        return await client.SendAsync(req);
    }

    private static string Envelope(string method, object @params) =>
        JsonSerializer.Serialize(new { jsonrpc = "2.0", id = 1, method, @params });

    private static object InitializeParams() => new
    {
        protocolVersion = ProtocolVersion,
        capabilities = new { },
        clientInfo = new { name = "test-client", version = "1.0" }
    };

    private static async Task<JsonElement> ReadResultAsync(HttpResponseMessage resp)
    {
        var body = await resp.Content.ReadAsStringAsync();
        var json = body.TrimStart().StartsWith("{") ? body : ExtractSseData(body);
        using var doc = JsonDocument.Parse(json);
        return doc.RootElement.GetProperty("result").Clone();
    }

    private static string ExtractSseData(string body)
    {
        var sb = new StringBuilder();
        foreach (var line in body.Split('\n'))
            if (line.StartsWith("data:"))
                sb.Append(line.AsSpan("data:".Length).Trim());
        return sb.ToString();
    }
}
