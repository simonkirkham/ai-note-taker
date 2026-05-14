using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;

namespace ApiIntegration;

public sealed class NoteTagsIntegrationTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private readonly HttpClient _client = factory.CreateClient();

    [Fact]
    public async Task PostTag_ReturnsNoContent()
    {
        var noteId = await CreateNoteAsync();

        var resp = await PostTagAsync(noteId, "1:1s");

        Assert.Equal(HttpStatusCode.NoContent, resp.StatusCode);
    }

    [Fact]
    public async Task PostTag_AppearsInGetNote()
    {
        var noteId = await CreateNoteAsync();
        await PostTagAsync(noteId, "1:1s");

        var get = await _client.GetAsync($"/notes/{noteId}");
        get.EnsureSuccessStatusCode();
        var body = await get.Content.ReadFromJsonAsync<JsonElement>();

        var tags = body.GetProperty("tags").EnumerateArray().Select(t => t.GetString()).ToList();
        Assert.Contains("1:1s", tags);
    }

    [Fact]
    public async Task PostTag_DuplicateReturns409()
    {
        var noteId = await CreateNoteAsync();
        await PostTagAsync(noteId, "1:1s");

        var resp = await PostTagAsync(noteId, "1:1s");

        Assert.Equal(HttpStatusCode.Conflict, resp.StatusCode);
    }

    [Fact]
    public async Task PostTag_AppearInGetCards()
    {
        var noteId = await CreateNoteAsync();
        await PostTagAsync(noteId, "1:1s");

        var resp = await _client.GetAsync("/notes/cards");
        resp.EnsureSuccessStatusCode();
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        var card = body.GetProperty("cards").EnumerateArray()
            .First(c => c.GetProperty("noteId").GetString() == noteId);

        var tags = card.GetProperty("tags").EnumerateArray().Select(t => t.GetString()).ToList();
        Assert.Contains("1:1s", tags);
    }

    [Fact]
    public async Task PostTag_NonExistentNoteReturns404()
    {
        var resp = await PostTagAsync(Guid.NewGuid().ToString(), "1:1s");

        Assert.Equal(HttpStatusCode.NotFound, resp.StatusCode);
    }

    [Fact]
    public async Task DeleteTag_RemovesTagFromGetNote()
    {
        var noteId = await CreateNoteAsync();
        await PostTagAsync(noteId, "1:1s");

        await _client.DeleteAsync($"/notes/{noteId}/tags/1:1s");

        var get = await _client.GetAsync($"/notes/{noteId}");
        get.EnsureSuccessStatusCode();
        var body = await get.Content.ReadFromJsonAsync<JsonElement>();
        var tags = body.GetProperty("tags").EnumerateArray().Select(t => t.GetString()).ToList();
        Assert.DoesNotContain("1:1s", tags);
    }

    [Fact]
    public async Task DeleteTag_NonExistentTagReturns404()
    {
        var noteId = await CreateNoteAsync();

        var resp = await _client.DeleteAsync($"/notes/{noteId}/tags/nonexistenttag");

        Assert.Equal(HttpStatusCode.NotFound, resp.StatusCode);
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
