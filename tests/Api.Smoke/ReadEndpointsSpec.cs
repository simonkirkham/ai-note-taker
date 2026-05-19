using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace Api.Smoke;

[Collection("Deployed API")]
public sealed class ReadEndpointsSpec(DeployedApiFixture fixture)
{
    [Fact]
    public async Task GetNotes_returns_200_with_items_array()
    {
        var response = await fixture.Client.GetAsync("notes");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(body.TryGetProperty("items", out var items), "response must include 'items'");
        Assert.Equal(JsonValueKind.Array, items.ValueKind);
    }

    [Fact]
    public async Task GetNoteCards_returns_200_with_cards_array()
    {
        var response = await fixture.Client.GetAsync("notes/cards");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(body.TryGetProperty("cards", out var cards), "response must include 'cards'");
        Assert.Equal(JsonValueKind.Array, cards.ValueKind);
    }

    [Fact]
    public async Task GetTodos_returns_200_with_items_array()
    {
        var response = await fixture.Client.GetAsync("todos");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(body.TryGetProperty("items", out var items), "response must include 'items'");
        Assert.Equal(JsonValueKind.Array, items.ValueKind);
    }

    [Fact]
    public async Task GetTags_returns_200_with_tags_array()
    {
        var response = await fixture.Client.GetAsync("tags");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(body.TryGetProperty("tags", out var tags), "response must include 'tags'");
        Assert.Equal(JsonValueKind.Array, tags.ValueKind);
    }

    [Fact]
    public async Task GetFolders_returns_200_with_folders_array()
    {
        var response = await fixture.Client.GetAsync("folders");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(body.TryGetProperty("folders", out var folders), "response must include 'folders'");
        Assert.Equal(JsonValueKind.Array, folders.ValueKind);
    }
}
