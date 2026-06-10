using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;

namespace Api.Integration;

public sealed class WorkspaceScopingIntegrationTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _factory = factory;
    private readonly HttpClient _client = factory.CreateClient();

    [Fact]
    public async Task NoteCreatedInWorkspace_AppearsOnlyInThatWorkspacesCards()
    {
        var wsA = await CreateWorkspaceAsync("A");
        var wsB = await CreateWorkspaceAsync("B");

        var noteId = await CreateNoteAsync($"/w/{wsA}/notes");

        Assert.Contains(noteId, await CardIdsAsync($"/w/{wsA}/notes/cards"));
        Assert.DoesNotContain(noteId, await CardIdsAsync($"/w/{wsB}/notes/cards"));
    }

    [Fact]
    public async Task RootlessNoteCreate_LandsInDefaultWorkspace()
    {
        var noteId = await CreateNoteAsync("/notes");

        Assert.Contains(noteId, await CardIdsAsync("/w/__default__/notes/cards"));
        Assert.Contains(noteId, await CardIdsAsync("/notes/cards"));
    }

    [Fact]
    public async Task RequestingAWorkspaceThatIsNotMine_Returns404()
    {
        // An id that exists for another user is still not mine.
        var otherClient = _factory.CreateClientAsOtherUser();
        var otherWs = await CreateWorkspaceAsync("Theirs", otherClient);

        var resp = await _client.GetAsync($"/w/{otherWs}/notes/cards");
        Assert.Equal(HttpStatusCode.NotFound, resp.StatusCode);

        // A wholly unknown id is also rejected.
        var unknown = await _client.GetAsync($"/w/{Guid.NewGuid():N}/notes/cards");
        Assert.Equal(HttpStatusCode.NotFound, unknown.StatusCode);
    }

    [Fact]
    public async Task DefaultWorkspaceRoute_IsAlwaysValid()
    {
        var resp = await _client.GetAsync("/w/__default__/notes/cards");
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
    }

    [Fact]
    public async Task Search_IsScopedToTheWorkspace()
    {
        var wsA = await CreateWorkspaceAsync("SearchA");
        var wsB = await CreateWorkspaceAsync("SearchB");

        var noteId = await CreateNoteAsync($"/w/{wsA}/notes");
        var rename = await _client.PatchAsync($"/w/{wsA}/notes/{noteId}/title",
            new StringContent("{\"title\":\"Quarterly Planning\"}", Encoding.UTF8, "application/json"));
        rename.EnsureSuccessStatusCode();

        Assert.Contains(noteId, await SearchIdsAsync($"/w/{wsA}/notes/search?q=Quarterly"));
        Assert.DoesNotContain(noteId, await SearchIdsAsync($"/w/{wsB}/notes/search?q=Quarterly"));
    }

    [Fact]
    public async Task NoteList_IsScopedToTheWorkspace()
    {
        var wsA = await CreateWorkspaceAsync("ListA");
        var wsB = await CreateWorkspaceAsync("ListB");

        var noteId = await CreateNoteAsync($"/w/{wsA}/notes");
        await _client.PatchAsync($"/w/{wsA}/notes/{noteId}/title",
            new StringContent("{\"title\":\"Scoped\"}", Encoding.UTF8, "application/json"));

        Assert.Contains(noteId, await ListIdsAsync($"/w/{wsA}/notes"));
        Assert.DoesNotContain(noteId, await ListIdsAsync($"/w/{wsB}/notes"));
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

    private async Task<List<string?>> CardIdsAsync(string path)
    {
        var resp = await _client.GetAsync(path);
        resp.EnsureSuccessStatusCode();
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        return body.GetProperty("cards").EnumerateArray()
            .Select(c => c.GetProperty("noteId").GetString())
            .ToList();
    }

    private async Task<List<string?>> ListIdsAsync(string path)
    {
        var resp = await _client.GetAsync(path);
        resp.EnsureSuccessStatusCode();
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        return body.GetProperty("items").EnumerateArray()
            .Select(c => c.GetProperty("noteId").GetString())
            .ToList();
    }

    private async Task<List<string?>> SearchIdsAsync(string path)
    {
        var resp = await _client.GetAsync(path);
        resp.EnsureSuccessStatusCode();
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        return body.GetProperty("items").EnumerateArray()
            .Select(c => c.GetProperty("noteId").GetString())
            .ToList();
    }
}
