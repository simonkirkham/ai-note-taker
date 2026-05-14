using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;

namespace Api.Smoke;

[Collection("Deployed API")]
public sealed class GetNoteSpec(DeployedApiFixture fixture)
{
    [Fact]
    public async Task GetNote_returns_200_with_title_content_and_timestamps()
    {
        var noteId = await CreateAndNameNoteAsync("Meeting notes");

        var resp = await fixture.Client.GetAsync($"notes/{noteId}");

        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(noteId, body.GetProperty("noteId").GetString());
        Assert.Equal("Meeting notes", body.GetProperty("title").GetString());
        Assert.True(body.TryGetProperty("content", out _), "response must include content");
        Assert.True(body.TryGetProperty("createdAt", out _), "response must include createdAt");
        Assert.True(body.TryGetProperty("lastModifiedAt", out _), "response must include lastModifiedAt");
    }

    [Fact]
    public async Task GetNote_nonexistent_returns_404()
    {
        var resp = await fixture.Client.GetAsync($"notes/{Guid.NewGuid()}");

        Assert.Equal(HttpStatusCode.NotFound, resp.StatusCode);
    }

    private async Task<string> CreateAndNameNoteAsync(string title)
    {
        var create = await fixture.Client.PostAsync("notes", null);
        var body = await create.Content.ReadFromJsonAsync<JsonElement>();
        var noteId = body.GetProperty("noteId").GetString()!;
        await fixture.Client.PatchAsync($"notes/{noteId}/title",
            new StringContent($"{{\"title\":\"{title}\"}}", Encoding.UTF8, "application/json"));
        return noteId;
    }
}
