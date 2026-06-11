using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace Api.Smoke;

[Collection("Deployed API")]
public sealed class ReadEndpointsSpec(DeployedApiFixture fixture)
{
    private const string AuthRequired = "SMOKE_TEST_TOKEN not configured — add GOOGLE_REFRESH_TOKEN_SSM_PATH secret to the GitHub environment to enable auth smoke tests";

    [SkippableFact]
    public async Task GetNotes_returns_200_with_items_array()
    {
        Skip.IfNot(fixture.IsAuthenticated, AuthRequired);
        var response = await fixture.Client.GetAsync("w/__default__/notes");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(body.TryGetProperty("items", out var items), "response must include 'items'");
        Assert.Equal(JsonValueKind.Array, items.ValueKind);
    }

    [SkippableFact]
    public async Task GetNoteCards_returns_200_with_cards_array()
    {
        Skip.IfNot(fixture.IsAuthenticated, AuthRequired);
        var response = await fixture.Client.GetAsync("w/__default__/notes/cards");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(body.TryGetProperty("cards", out var cards), "response must include 'cards'");
        Assert.Equal(JsonValueKind.Array, cards.ValueKind);
    }

    [SkippableFact]
    public async Task GetTodos_returns_200_with_items_array()
    {
        Skip.IfNot(fixture.IsAuthenticated, AuthRequired);
        var response = await fixture.Client.GetAsync("w/__default__/todos");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(body.TryGetProperty("items", out var items), "response must include 'items'");
        Assert.Equal(JsonValueKind.Array, items.ValueKind);
    }

    [SkippableFact]
    public async Task GetTags_returns_200_with_tags_array()
    {
        Skip.IfNot(fixture.IsAuthenticated, AuthRequired);
        var response = await fixture.Client.GetAsync("w/__default__/tags");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(body.TryGetProperty("tags", out var tags), "response must include 'tags'");
        Assert.Equal(JsonValueKind.Array, tags.ValueKind);
    }

    [SkippableFact]
    public async Task GetFolders_returns_200_with_folders_array()
    {
        Skip.IfNot(fixture.IsAuthenticated, AuthRequired);
        var response = await fixture.Client.GetAsync("w/__default__/folders");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(body.TryGetProperty("folders", out var folders), "response must include 'folders'");
        Assert.Equal(JsonValueKind.Array, folders.ValueKind);
    }
}
