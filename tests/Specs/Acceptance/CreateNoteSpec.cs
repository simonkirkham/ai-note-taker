using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;

namespace Specs.Acceptance;

public sealed class CreateNoteSpec
{
    [Fact]
    public async Task PostNotes_returns_201_with_noteId()
    {
        var baseUrl = Environment.GetEnvironmentVariable("API_BASE_URL");
        if (string.IsNullOrWhiteSpace(baseUrl)) return;

        using var client = new HttpClient();
        var response = await client.PostAsync($"{baseUrl.TrimEnd('/')}/notes", null);

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);

        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(body.TryGetProperty("noteId", out var noteIdProp));
        Assert.True(Guid.TryParse(noteIdProp.GetString(), out _));
    }

    [Fact]
    public async Task PostNotes_with_duplicate_noteId_returns_409()
    {
        var baseUrl = Environment.GetEnvironmentVariable("API_BASE_URL");
        if (string.IsNullOrWhiteSpace(baseUrl)) return;

        using var client = new HttpClient();

        var first = await client.PostAsync($"{baseUrl.TrimEnd('/')}/notes", null);
        var body = await first.Content.ReadFromJsonAsync<JsonElement>();
        var noteId = body.GetProperty("noteId").GetString();

        var json = new StringContent($"{{\"noteId\":\"{noteId}\"}}", Encoding.UTF8, "application/json");
        var second = await client.PostAsync($"{baseUrl.TrimEnd('/')}/notes", json);

        Assert.Equal(HttpStatusCode.Conflict, second.StatusCode);
    }
}
