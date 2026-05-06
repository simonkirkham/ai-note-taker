using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;

namespace ApiIntegration;

public sealed class GetNoteTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private readonly HttpClient _client = factory.CreateClient();

    [Fact]
    public async Task GetNote_returns_200_with_noteId_title_content_and_timestamps()
    {
        var noteId = await CreateAndNameNoteAsync("Bill 1:1");

        var resp = await _client.GetAsync($"/notes/{noteId}");

        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(noteId, body.GetProperty("noteId").GetString());
        Assert.Equal("Bill 1:1", body.GetProperty("title").GetString());
        Assert.True(body.TryGetProperty("content", out _), "response must include content");
        Assert.True(body.TryGetProperty("createdAt", out _), "response must include createdAt");
        Assert.True(body.TryGetProperty("lastModifiedAt", out _), "response must include lastModifiedAt");
    }

    [Fact]
    public async Task GetNote_nonexistent_returns_404()
    {
        var resp = await _client.GetAsync($"/notes/{Guid.NewGuid()}");

        Assert.Equal(HttpStatusCode.NotFound, resp.StatusCode);
    }

    private async Task<string> CreateAndNameNoteAsync(string title)
    {
        var create = await _client.PostAsync("/notes", null);
        var noteId = (await create.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("noteId").GetString()!;
        await _client.PatchAsync($"/notes/{noteId}/title",
            new StringContent($"{{\"title\":\"{title}\"}}", Encoding.UTF8, "application/json"));
        return noteId;
    }
}
