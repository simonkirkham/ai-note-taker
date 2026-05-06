using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;

namespace Acceptance;

[Collection("Deployed API")]
public sealed class EditContentSpec(DeployedApiFixture fixture)
{
    [Fact]
    public async Task PutContent_ExistingNote_Returns204()
    {
        var noteId = await CreateNoteAsync();

        var resp = await fixture.Client.PutAsync($"notes/{noteId}/content",
            new StringContent("{\"content\":\"Today we discussed the roadmap.\"}", Encoding.UTF8, "application/json"));

        Assert.Equal(HttpStatusCode.NoContent, resp.StatusCode);
    }

    [Fact]
    public async Task PutContent_NonExistentNote_Returns404()
    {
        var resp = await fixture.Client.PutAsync($"notes/{Guid.NewGuid()}/content",
            new StringContent("{\"content\":\"Some content\"}", Encoding.UTF8, "application/json"));

        Assert.Equal(HttpStatusCode.NotFound, resp.StatusCode);
    }

    [Fact]
    public async Task PutContent_ThenGetNote_ReturnsUpdatedContent()
    {
        var noteId = await CreateNoteAsync();

        await fixture.Client.PutAsync($"notes/{noteId}/content",
            new StringContent("{\"content\":\"Sprint retrospective notes.\"}", Encoding.UTF8, "application/json"));

        var resp = await fixture.Client.GetAsync($"notes/{noteId}");
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("Sprint retrospective notes.", body.GetProperty("content").GetString());
    }

    private async Task<string> CreateNoteAsync()
    {
        var create = await fixture.Client.PostAsync("notes", null);
        var body = await create.Content.ReadFromJsonAsync<JsonElement>();
        return body.GetProperty("noteId").GetString()!;
    }
}
