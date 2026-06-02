using System.Net.Http.Json;
using System.Text;
using System.Text.Json;

namespace Api.Integration;

public sealed class NoteCardsEmptyStateTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    [Fact]
    public async Task GetNoteCards_ReturnsEmptyWhenNoNotes()
    {
        var client = factory.CreateClient();
        var resp = await client.GetAsync("/notes/cards");
        resp.EnsureSuccessStatusCode();
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(0, body.GetProperty("cards").GetArrayLength());
    }
}

public sealed class NoteCardsIntegrationTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private readonly HttpClient _client = factory.CreateClient();

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
    public async Task GetNoteCards_CardIncludesLastModifiedAt()
    {
        var noteId = await CreateNoteAsync();

        var card = await GetCardAsync(noteId);
        Assert.True(card.TryGetProperty("lastModifiedAt", out var lastModified),
            "card should include lastModifiedAt");
        Assert.NotEqual(JsonValueKind.Null, lastModified.ValueKind);
        Assert.True(lastModified.TryGetDateTimeOffset(out _),
            "lastModifiedAt should be a valid timestamp");
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

public sealed class NoteCardMarkdownPreviewTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private readonly HttpClient _client = factory.CreateClient();

    [Fact]
    public async Task GetNoteCards_HeadingTokensStrippedFromPreview()
    {
        var noteId = await CreateNoteAsync();
        await PutAsync($"/notes/{noteId}/content", "{\"content\":\"## Budget review\\nSome notes\"}");

        var card = await GetCardAsync(noteId);
        var preview = card.GetProperty("contentPreview").GetString()!;
        Assert.DoesNotContain("##", preview);
        Assert.Contains("Budget review", preview);
    }

    [Fact]
    public async Task GetNoteCards_BoldTokensStrippedFromPreview()
    {
        var noteId = await CreateNoteAsync();
        await PutAsync($"/notes/{noteId}/content", "{\"content\":\"**agreed** £50k cap\"}");

        var card = await GetCardAsync(noteId);
        var preview = card.GetProperty("contentPreview").GetString()!;
        Assert.DoesNotContain("**", preview);
        Assert.Contains("agreed", preview);
    }

    [Fact]
    public async Task GetNoteCards_BulletTokensStrippedFromPreview()
    {
        var noteId = await CreateNoteAsync();
        await PutAsync($"/notes/{noteId}/content", "{\"content\":\"- First item\\n- Second item\"}");

        var card = await GetCardAsync(noteId);
        var preview = card.GetProperty("contentPreview").GetString()!;
        Assert.DoesNotContain("- First", preview);
        Assert.Contains("First item", preview);
    }

    [Fact]
    public async Task GetNoteCards_OrderedListTokensStrippedFromPreview()
    {
        var noteId = await CreateNoteAsync();
        await PutAsync($"/notes/{noteId}/content", "{\"content\":\"1. First item\\n2. Second item\"}");

        var card = await GetCardAsync(noteId);
        var preview = card.GetProperty("contentPreview").GetString()!;
        Assert.DoesNotContain("1.", preview);
        Assert.Contains("First item", preview);
    }

    [Fact]
    public async Task GetNoteCards_StrikethroughStrippedFromPreview()
    {
        var noteId = await CreateNoteAsync();
        await PutAsync($"/notes/{noteId}/content", "{\"content\":\"## ~~Budget review~~\"}");

        var card = await GetCardAsync(noteId);
        var preview = card.GetProperty("contentPreview").GetString()!;
        Assert.DoesNotContain("~~", preview);
        Assert.DoesNotContain("##", preview);
        Assert.Contains("Budget review", preview);
    }

    [Fact]
    public async Task GetNoteCards_PreviewTruncatedAfterStripping()
    {
        var noteId = await CreateNoteAsync();
        var longText = new string('x', 150);
        await PutAsync($"/notes/{noteId}/content", $"{{\"content\":\"## {longText}\"}}");

        var card = await GetCardAsync(noteId);
        var preview = card.GetProperty("contentPreview").GetString()!;
        Assert.DoesNotContain("##", preview);
        Assert.True(preview.Length <= 120, $"Preview length {preview.Length} exceeds 120");
        Assert.EndsWith("…", preview);
    }

    private async Task<string> CreateNoteAsync()
    {
        var resp = await _client.PostAsync("/notes", null);
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        return body.GetProperty("noteId").GetString()!;
    }

    private Task<HttpResponseMessage> PutAsync(string url, string json) =>
        _client.PutAsync(url, new StringContent(json, Encoding.UTF8, "application/json"));

    private async Task<JsonElement> GetCardAsync(string noteId)
    {
        var resp = await _client.GetAsync("/notes/cards");
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        return body.GetProperty("cards").EnumerateArray()
            .First(c => c.GetProperty("noteId").GetString() == noteId);
    }
}

