using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;

namespace Api.Integration;

public sealed class EditContentTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private readonly HttpClient _client = factory.CreateClient();

    [Fact]
    public async Task PutContent_ExistingNote_Returns204()
    {
        var noteId = await CreateNoteAsync();

        var resp = await _client.PutAsync($"/notes/{noteId}/content",
            new StringContent("{\"content\":\"Today we discussed the roadmap.\"}", Encoding.UTF8, "application/json"));

        Assert.Equal(HttpStatusCode.NoContent, resp.StatusCode);
    }

    [Fact]
    public async Task PutContent_NonExistentNote_Returns404()
    {
        var resp = await _client.PutAsync($"/notes/{Guid.NewGuid()}/content",
            new StringContent("{\"content\":\"Some content\"}", Encoding.UTF8, "application/json"));

        Assert.Equal(HttpStatusCode.NotFound, resp.StatusCode);
    }

    [Fact]
    public async Task PutContent_ThenGetNote_ReturnsUpdatedContentAndBumpsLastModifiedAt()
    {
        var noteId = await CreateNoteAsync();
        var before = (await (await _client.GetAsync($"/notes/{noteId}"))
            .Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("lastModifiedAt").GetString();

        await _client.PutAsync($"/notes/{noteId}/content",
            new StringContent("{\"content\":\"Sprint retrospective notes.\"}", Encoding.UTF8, "application/json"));

        var resp = await _client.GetAsync($"/notes/{noteId}");
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("Sprint retrospective notes.", body.GetProperty("content").GetString());
        var after = body.GetProperty("lastModifiedAt").GetString();
        Assert.NotEqual(before, after);
    }

    private async Task<string> CreateNoteAsync()
    {
        var create = await _client.PostAsync("/notes", null);
        return (await create.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("noteId").GetString()!;
    }
}
