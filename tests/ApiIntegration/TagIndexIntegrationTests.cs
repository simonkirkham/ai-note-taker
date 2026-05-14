using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;

namespace ApiIntegration;

public sealed class TagIndexIntegrationTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private readonly HttpClient _client = factory.CreateClient();

    [Fact]
    public async Task GetTags_ReturnsEmptyWhenNoTags()
    {
        var resp = await _client.GetAsync("/tags");

        resp.EnsureSuccessStatusCode();
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        var tags = body.GetProperty("tags").EnumerateArray().ToList();
        Assert.Empty(tags);
    }

    [Fact]
    public async Task GetTags_ReturnsTagAfterAdded()
    {
        var noteId = await CreateNoteAsync();
        await PostTagAsync(noteId, "standup");

        var resp = await _client.GetAsync("/tags");

        resp.EnsureSuccessStatusCode();
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        var tags = body.GetProperty("tags").EnumerateArray().ToList();
        Assert.Contains(tags, t => t.GetProperty("tag").GetString() == "standup");
    }

    [Fact]
    public async Task GetTags_NoteCountIncrementsForSameTag()
    {
        var noteId1 = await CreateNoteAsync();
        var noteId2 = await CreateNoteAsync();
        await PostTagAsync(noteId1, "retro");
        await PostTagAsync(noteId2, "retro");

        var resp = await _client.GetAsync("/tags");

        resp.EnsureSuccessStatusCode();
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        var retroTag = body.GetProperty("tags").EnumerateArray()
            .FirstOrDefault(t => t.GetProperty("tag").GetString() == "retro");
        Assert.Equal(2, retroTag.GetProperty("noteCount").GetInt32());
    }

    [Fact]
    public async Task GetTags_NoteCountDecrementsWhenTagRemoved()
    {
        var noteId1 = await CreateNoteAsync();
        var noteId2 = await CreateNoteAsync();
        await PostTagAsync(noteId1, "planning");
        await PostTagAsync(noteId2, "planning");
        await _client.DeleteAsync($"/notes/{noteId1}/tags/planning");

        var resp = await _client.GetAsync("/tags");

        resp.EnsureSuccessStatusCode();
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        var planningTag = body.GetProperty("tags").EnumerateArray()
            .FirstOrDefault(t => t.GetProperty("tag").GetString() == "planning");
        Assert.Equal(1, planningTag.GetProperty("noteCount").GetInt32());
    }

    [Fact]
    public async Task GetTags_TagRemovedWhenLastNoteUntagged()
    {
        var noteId = await CreateNoteAsync();
        await PostTagAsync(noteId, "solo-tag");
        await _client.DeleteAsync($"/notes/{noteId}/tags/solo-tag");

        var resp = await _client.GetAsync("/tags");

        resp.EnsureSuccessStatusCode();
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        var tags = body.GetProperty("tags").EnumerateArray().ToList();
        Assert.DoesNotContain(tags, t => t.GetProperty("tag").GetString() == "solo-tag");
    }

    [Fact]
    public async Task GetTags_OrderedByNoteCountDescending()
    {
        var noteId1 = await CreateNoteAsync();
        var noteId2 = await CreateNoteAsync();
        var noteId3 = await CreateNoteAsync();
        await PostTagAsync(noteId1, "rare-tag");
        await PostTagAsync(noteId1, "common-tag");
        await PostTagAsync(noteId2, "common-tag");
        await PostTagAsync(noteId3, "common-tag");

        var resp = await _client.GetAsync("/tags");

        resp.EnsureSuccessStatusCode();
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        var tags = body.GetProperty("tags").EnumerateArray()
            .Select(t => t.GetProperty("tag").GetString()!)
            .ToList();
        var commonIdx = tags.IndexOf("common-tag");
        var rareIdx = tags.IndexOf("rare-tag");
        Assert.True(commonIdx < rareIdx, "common-tag (count=3) should appear before rare-tag (count=1)");
    }

    [Fact]
    public async Task GetTags_TagRemovedWhenNoteDeleted()
    {
        var noteId = await CreateNoteAsync();
        await PostTagAsync(noteId, "delete-me-tag");

        await _client.DeleteAsync($"/notes/{noteId}");

        var resp = await _client.GetAsync("/tags");
        resp.EnsureSuccessStatusCode();
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        var tags = body.GetProperty("tags").EnumerateArray().ToList();
        Assert.DoesNotContain(tags, t => t.GetProperty("tag").GetString() == "delete-me-tag");
    }

    private async Task<string> CreateNoteAsync()
    {
        var resp = await _client.PostAsync("/notes", null);
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        return body.GetProperty("noteId").GetString()!;
    }

    private Task<HttpResponseMessage> PostTagAsync(string noteId, string tag) =>
        _client.PostAsync(
            $"/notes/{noteId}/tags",
            new StringContent($"{{\"tag\":\"{tag}\"}}", Encoding.UTF8, "application/json"));
}
