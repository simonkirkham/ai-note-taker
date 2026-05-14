using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;

namespace Api.Smoke;

[Collection("Deployed API")]
public sealed class CreateNoteSpec(DeployedApiFixture fixture)
{
    [Fact]
    public async Task PostNotes_returns_201_with_noteId()
    {
        var response = await fixture.Client.PostAsync("notes", null);

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(body.TryGetProperty("noteId", out var noteIdProp));
        Assert.True(Guid.TryParse(noteIdProp.GetString(), out _));
    }

    [Fact]
    public async Task PostNotes_with_duplicate_noteId_returns_409()
    {
        var first = await fixture.Client.PostAsync("notes", null);
        var noteId = (await first.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("noteId").GetString();

        var json = new StringContent($"{{\"noteId\":\"{noteId}\"}}", Encoding.UTF8, "application/json");
        var second = await fixture.Client.PostAsync("notes", json);

        Assert.Equal(HttpStatusCode.Conflict, second.StatusCode);
    }
}
