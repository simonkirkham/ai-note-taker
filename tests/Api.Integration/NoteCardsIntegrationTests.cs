using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;

namespace Api.Integration;

public sealed class NoteCardsIntegrationTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private readonly HttpClient _client = factory.CreateClient();

    [Fact]
    public async Task GetNoteCards_ReturnsEmptyWhenNoNotes()
    {
        var resp = await _client.GetAsync("/notes/cards");
        resp.EnsureSuccessStatusCode();
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(0, body.GetProperty("cards").GetArrayLength());
    }

    [Fact]
    public async Task GetNoteCards_ReturnsCardAfterNoteCreated()
    {
        var noteId = await CreateNoteAsync();

        var resp = await _client.GetAsync("/notes/cards");
        resp.EnsureSuccessStatusCode();
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        var ids = body.GetProperty("cards").EnumerateArray()
            .Select(c => c.GetProperty("noteId").GetString()).ToList();
        Assert.Contains(noteId, ids);
    }

    [Fact]
    public async Task GetNoteCards_CardShowsTitle()
    {
        var noteId = await CreateNoteAsync();
        await PatchAsync($"/notes/{noteId}/title", "{\"title\":\"Budget 2027\"}");

        var card = await GetCardAsync(noteId);
        Assert.Equal("Budget 2027", card.GetProperty("title").GetString());
    }

    [Fact]
    public async Task GetNoteCards_CardShowsDate()
    {
        var noteId = await CreateNoteAsync();
        await PatchAsync($"/notes/{noteId}/date", "{\"date\":\"2026-04-21\"}");

        var card = await GetCardAsync(noteId);
        Assert.Equal("2026-04-21", card.GetProperty("date").GetString());
    }

    [Fact]
    public async Task GetNoteCards_CardContentPreviewTruncatedAt120Chars()
    {
        var noteId = await CreateNoteAsync();
        var content = new string('x', 150);
        await PutAsync($"/notes/{noteId}/content", $"{{\"content\":\"{content}\"}}");

        var card = await GetCardAsync(noteId);
        var preview = card.GetProperty("contentPreview").GetString()!;
        Assert.True(preview.Length <= 120, $"Preview too long: {preview.Length}");
        Assert.EndsWith("…", preview);
    }

    [Fact]
    public async Task GetNoteCards_DeletedNoteNotReturned()
    {
        var noteId = await CreateNoteAsync();
        await _client.DeleteAsync($"/notes/{noteId}");

        var resp = await _client.GetAsync("/notes/cards");
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        var ids = body.GetProperty("cards").EnumerateArray()
            .Select(c => c.GetProperty("noteId").GetString()).ToList();
        Assert.DoesNotContain(noteId, ids);
    }

    [Fact]
    public async Task GetNoteCards_OnlyOpenActionsInCard()
    {
        var noteId = await CreateNoteAsync();
        await AddActionAsync(noteId, "Open task");
        var completedId = await AddActionAsync(noteId, "Completed task");
        await _client.PostAsync($"/notes/{noteId}/actions/{completedId}/complete", null);

        var card = await GetCardAsync(noteId);
        var openActions = card.GetProperty("openActions").EnumerateArray().ToList();
        Assert.Single(openActions);
        Assert.Equal("Open task", openActions[0].GetProperty("description").GetString());
    }

    [Fact]
    public async Task GetNoteCards_OrderedNewestFirst()
    {
        var firstNoteId = await CreateNoteAsync();
        var secondNoteId = await CreateNoteAsync();

        var resp = await _client.GetAsync("/notes/cards");
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        var ids = body.GetProperty("cards").EnumerateArray()
            .Select(c => c.GetProperty("noteId").GetString()).ToList();
        var firstIdx = ids.IndexOf(firstNoteId);
        var secondIdx = ids.IndexOf(secondNoteId);
        Assert.True(secondIdx < firstIdx, "Newer note should appear before older note");
    }

    private async Task<string> CreateNoteAsync()
    {
        var resp = await _client.PostAsync("/notes", null);
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        return body.GetProperty("noteId").GetString()!;
    }

    private Task<HttpResponseMessage> PatchAsync(string url, string json) =>
        _client.PatchAsync(url, new StringContent(json, Encoding.UTF8, "application/json"));

    private Task<HttpResponseMessage> PutAsync(string url, string json) =>
        _client.PutAsync(url, new StringContent(json, Encoding.UTF8, "application/json"));

    private async Task<string> AddActionAsync(string noteId, string description)
    {
        var resp = await _client.PostAsync($"/notes/{noteId}/actions",
            new StringContent($"{{\"description\":\"{description}\"}}", Encoding.UTF8, "application/json"));
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        return body.GetProperty("actionId").GetString()!;
    }

    private async Task<JsonElement> GetCardAsync(string noteId)
    {
        var resp = await _client.GetAsync("/notes/cards");
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        return body.GetProperty("cards").EnumerateArray()
            .First(c => c.GetProperty("noteId").GetString() == noteId);
    }
}

