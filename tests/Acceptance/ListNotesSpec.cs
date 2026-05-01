using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace Acceptance;

[Collection("Deployed API")]
public sealed class ListNotesSpec(DeployedApiFixture fixture)
{
    [Fact]
    public async Task GetNotes_returns_200_containing_created_note()
    {
        var created = await fixture.Client.PostAsync("notes", null);
        var noteId = (await created.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("noteId").GetString();

        var response = await fixture.Client.GetAsync("notes");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        var items = body.GetProperty("items").EnumerateArray();
        Assert.Contains(items, i => i.GetProperty("noteId").GetString() == noteId);
    }
}
