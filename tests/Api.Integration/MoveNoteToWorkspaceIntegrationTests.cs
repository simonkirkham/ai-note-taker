using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;

namespace Api.Integration;

[Collection("ProjectionRebuild")]
public sealed class MoveNoteToWorkspaceIntegrationTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _factory = factory;
    private readonly HttpClient _client = factory.CreateClient();

    [Fact]
    public async Task MovingANote_RebucketsItsCardToTheTarget()
    {
        var wsA = await CreateWorkspaceAsync("MoveCardA");
        var wsB = await CreateWorkspaceAsync("MoveCardB");
        var noteId = await CreateNoteAsync($"/w/{wsA}/notes");

        await MoveAsync(wsA, noteId, wsB);

        Assert.Contains(noteId, await CardIdsAsync($"/w/{wsB}/notes/cards"));
        Assert.DoesNotContain(noteId, await CardIdsAsync($"/w/{wsA}/notes/cards"));
    }

    [Fact]
    public async Task MovingANote_RebucketsItsTagsAndActionItemTodos()
    {
        var wsA = await CreateWorkspaceAsync("MoveDerivedA");
        var wsB = await CreateWorkspaceAsync("MoveDerivedB");
        var noteId = await CreateNoteAsync($"/w/{wsA}/notes");

        await PostAsync($"/w/{wsA}/notes/{noteId}/tags", "{\"tag\":\"moved\"}", HttpStatusCode.NoContent);
        await PostAsync($"/w/{wsA}/notes/{noteId}/actions", "{\"description\":\"follow up\"}");

        await MoveAsync(wsA, noteId, wsB);

        Assert.Contains("moved", await TagsAsync($"/w/{wsB}/tags"));
        Assert.DoesNotContain("moved", await TagsAsync($"/w/{wsA}/tags"));
        Assert.Contains("follow up", await TodoDescriptionsAsync($"/w/{wsB}/todos"));
        Assert.DoesNotContain("follow up", await TodoDescriptionsAsync($"/w/{wsA}/todos"));
    }

    [Fact]
    public async Task MovedNotesDerivedRows_SurviveAFullRebuildIdentically()
    {
        // The live re-bucket must reproduce what a rebuild from the event stream produces —
        // the slice's highest-risk invariant. Move a tagged note with an action-item todo,
        // then rebuild and assert the tag/todo stay in B (and out of A) unchanged.
        var wsA = await CreateWorkspaceAsync("ConvergeA");
        var wsB = await CreateWorkspaceAsync("ConvergeB");
        var noteId = await CreateNoteAsync($"/w/{wsA}/notes");
        await PostAsync($"/w/{wsA}/notes/{noteId}/tags", "{\"tag\":\"conv\"}", HttpStatusCode.NoContent);
        await PostAsync($"/w/{wsA}/notes/{noteId}/actions", "{\"description\":\"converge\"}");

        await MoveAsync(wsA, noteId, wsB);
        Assert.Contains("conv", await TagsAsync($"/w/{wsB}/tags"));
        Assert.Contains("converge", await TodoDescriptionsAsync($"/w/{wsB}/todos"));

        (await _client.PostAsync("/admin/projections/rebuild", null)).EnsureSuccessStatusCode();

        Assert.Contains("conv", await TagsAsync($"/w/{wsB}/tags"));
        Assert.DoesNotContain("conv", await TagsAsync($"/w/{wsA}/tags"));
        Assert.Contains("converge", await TodoDescriptionsAsync($"/w/{wsB}/todos"));
        Assert.DoesNotContain("converge", await TodoDescriptionsAsync($"/w/{wsA}/todos"));
    }

    [Fact]
    public async Task MovingAFiledNote_ClearsItsFolder()
    {
        var wsA = await CreateWorkspaceAsync("MoveFiledA");
        var wsB = await CreateWorkspaceAsync("MoveFiledB");
        var noteId = await CreateNoteAsync($"/w/{wsA}/notes");
        var folderId = await CreateFolderAsync(wsA, "Filed");
        await PutAsync($"/w/{wsA}/notes/{noteId}/folder", $"{{\"folderId\":\"{folderId}\"}}", HttpStatusCode.NoContent);

        await MoveAsync(wsA, noteId, wsB);

        var detail = await _client.GetAsync($"/w/{wsB}/notes/{noteId}");
        detail.EnsureSuccessStatusCode();
        var body = await detail.Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(body.TryGetProperty("folderId", out var folder) is false || folder.ValueKind == JsonValueKind.Null);
    }

    [Fact]
    public async Task MovingToTheSameWorkspace_IsANoOp()
    {
        var wsA = await CreateWorkspaceAsync("MoveSame");
        var noteId = await CreateNoteAsync($"/w/{wsA}/notes");

        await MoveAsync(wsA, noteId, wsA);

        Assert.Contains(noteId, await CardIdsAsync($"/w/{wsA}/notes/cards"));
    }

    [Fact]
    public async Task MovingToAWorkspaceThatIsNotMine_Returns404()
    {
        var wsA = await CreateWorkspaceAsync("MoveSourceA");
        var noteId = await CreateNoteAsync($"/w/{wsA}/notes");
        var otherClient = _factory.CreateClientAsOtherUser();
        var theirWs = await CreateWorkspaceAsync("Theirs", otherClient);

        var resp = await _client.PutAsync($"/w/{wsA}/notes/{noteId}/workspace",
            new StringContent($"{{\"workspaceId\":\"{theirWs}\"}}", Encoding.UTF8, "application/json"));
        Assert.Equal(HttpStatusCode.NotFound, resp.StatusCode);
    }

    [Fact]
    public async Task MovingANoteThatDoesNotExist_Returns404()
    {
        var wsA = await CreateWorkspaceAsync("MoveMissingA");
        var wsB = await CreateWorkspaceAsync("MoveMissingB");

        var resp = await _client.PutAsync($"/w/{wsA}/notes/{Guid.NewGuid()}/workspace",
            new StringContent($"{{\"workspaceId\":\"{wsB}\"}}", Encoding.UTF8, "application/json"));
        Assert.Equal(HttpStatusCode.NotFound, resp.StatusCode);
    }

    private async Task MoveAsync(string sourceWs, string noteId, string targetWs)
    {
        var resp = await _client.PutAsync($"/w/{sourceWs}/notes/{noteId}/workspace",
            new StringContent($"{{\"workspaceId\":\"{targetWs}\"}}", Encoding.UTF8, "application/json"));
        Assert.Equal(HttpStatusCode.NoContent, resp.StatusCode);
    }

    private async Task PostAsync(string path, string json, HttpStatusCode? expected = null)
    {
        var resp = await _client.PostAsync(path, new StringContent(json, Encoding.UTF8, "application/json"));
        if (expected is { } code) Assert.Equal(code, resp.StatusCode);
        else resp.EnsureSuccessStatusCode();
    }

    private async Task PutAsync(string path, string json, HttpStatusCode expected)
    {
        var resp = await _client.PutAsync(path, new StringContent(json, Encoding.UTF8, "application/json"));
        Assert.Equal(expected, resp.StatusCode);
    }

    private async Task<string> CreateWorkspaceAsync(string name, HttpClient? client = null)
    {
        client ??= _client;
        var resp = await client.PostAsync("/workspaces",
            new StringContent($"{{\"name\":\"{name}\"}}", Encoding.UTF8, "application/json"));
        Assert.Equal(HttpStatusCode.Created, resp.StatusCode);
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        return body.GetProperty("workspaceId").GetString()!;
    }

    private async Task<string> CreateNoteAsync(string path)
    {
        var resp = await _client.PostAsync(path, new StringContent("{}", Encoding.UTF8, "application/json"));
        Assert.Equal(HttpStatusCode.Created, resp.StatusCode);
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        return body.GetProperty("noteId").GetString()!;
    }

    private async Task<string> CreateFolderAsync(string ws, string name)
    {
        var resp = await _client.PostAsync($"/w/{ws}/folders",
            new StringContent($"{{\"name\":\"{name}\"}}", Encoding.UTF8, "application/json"));
        resp.EnsureSuccessStatusCode();
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        return body.GetProperty("folderId").GetString()!;
    }

    private async Task<List<string?>> CardIdsAsync(string path)
    {
        var resp = await _client.GetAsync(path);
        resp.EnsureSuccessStatusCode();
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        return body.GetProperty("cards").EnumerateArray()
            .Select(c => c.GetProperty("noteId").GetString())
            .ToList();
    }

    private async Task<List<string?>> TagsAsync(string path)
    {
        var resp = await _client.GetAsync(path);
        resp.EnsureSuccessStatusCode();
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        return body.GetProperty("tags").EnumerateArray()
            .Select(t => t.GetProperty("tag").GetString())
            .ToList();
    }

    private async Task<List<string?>> TodoDescriptionsAsync(string path)
    {
        var resp = await _client.GetAsync(path);
        resp.EnsureSuccessStatusCode();
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        return body.GetProperty("items").EnumerateArray()
            .Select(i => i.GetProperty("description").GetString())
            .ToList();
    }
}
