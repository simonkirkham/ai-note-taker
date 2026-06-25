using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;

namespace Api.Integration;

public sealed class WorkspaceFolderTodoScopingIntegrationTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private readonly HttpClient _client = factory.CreateClient();

    [Fact]
    public async Task FoldersAreScopedToTheWorkspace()
    {
        var wsA = await CreateWorkspaceAsync("FolderA");
        var wsB = await CreateWorkspaceAsync("FolderB");

        var folderId = await CreateFolderAsync($"/w/{wsA}/folders", "Clients");

        Assert.Contains(folderId, await FolderIdsAsync($"/w/{wsA}/folders"));
        Assert.DoesNotContain(folderId, await FolderIdsAsync($"/w/{wsB}/folders"));
    }

    [Fact]
    public async Task ActionItemTodosAreScopedToTheParentNotesWorkspace()
    {
        var wsA = await CreateWorkspaceAsync("TodoNoteA");
        var wsB = await CreateWorkspaceAsync("TodoNoteB");
        var noteId = await CreateNoteAsync($"/w/{wsA}/notes");

        var addResp = await _client.PostAsync($"/w/{wsA}/notes/{noteId}/actions",
            new StringContent("{\"description\":\"call client\"}", Encoding.UTF8, "application/json"));
        addResp.EnsureSuccessStatusCode();

        Assert.Contains("call client", await TodoDescriptionsAsync($"/w/{wsA}/todos"));
        Assert.DoesNotContain("call client", await TodoDescriptionsAsync($"/w/{wsB}/todos"));
    }

    [Fact]
    public async Task StandaloneTodosAreScopedToTheWorkspace()
    {
        var wsA = await CreateWorkspaceAsync("StandaloneA");
        var wsB = await CreateWorkspaceAsync("StandaloneB");

        var addResp = await _client.PostAsync($"/w/{wsA}/todos",
            new StringContent("{\"description\":\"buy milk\"}", Encoding.UTF8, "application/json"));
        addResp.EnsureSuccessStatusCode();

        Assert.Contains("buy milk", await TodoDescriptionsAsync($"/w/{wsA}/todos"));
        Assert.DoesNotContain("buy milk", await TodoDescriptionsAsync($"/w/{wsB}/todos"));
    }

    [Fact]
    public async Task DeletingANonEmptyWorkspaceReturns409()
    {
        var ws = await CreateWorkspaceAsync("HasNote");
        await CreateNoteAsync($"/w/{ws}/notes");

        var resp = await _client.DeleteAsync($"/workspaces/{ws}");
        Assert.Equal(HttpStatusCode.Conflict, resp.StatusCode);
    }

    [Fact]
    public async Task DeletingAWorkspaceWhoseNotesAreAllDeletedSucceeds()
    {
        var ws = await CreateWorkspaceAsync("WillEmpty");
        var noteId = await CreateNoteAsync($"/w/{ws}/notes");

        var del = await _client.DeleteAsync($"/w/{ws}/notes/{noteId}");
        Assert.Equal(HttpStatusCode.NoContent, del.StatusCode);

        var resp = await _client.DeleteAsync($"/workspaces/{ws}");
        Assert.Equal(HttpStatusCode.NoContent, resp.StatusCode);
    }

    [Fact]
    public async Task DeletingAnEmptyWorkspaceSucceeds()
    {
        var ws = await CreateWorkspaceAsync("Empty");
        var resp = await _client.DeleteAsync($"/workspaces/{ws}");
        Assert.Equal(HttpStatusCode.NoContent, resp.StatusCode);
    }

    private async Task<string> CreateWorkspaceAsync(string name)
    {
        var resp = await _client.PostAsync("/workspaces",
            new StringContent($"{{\"name\":\"{name}\"}}", Encoding.UTF8, "application/json"));
        Assert.Equal(HttpStatusCode.Created, resp.StatusCode);
        return (await resp.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("workspaceId").GetString()!;
    }

    private async Task<string> CreateNoteAsync(string path)
    {
        var resp = await _client.PostAsync(path, new StringContent("{}", Encoding.UTF8, "application/json"));
        Assert.Equal(HttpStatusCode.Created, resp.StatusCode);
        return (await resp.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("noteId").GetString()!;
    }

    private async Task<string> CreateFolderAsync(string path, string name)
    {
        var resp = await _client.PostAsync(path,
            new StringContent($"{{\"name\":\"{name}\"}}", Encoding.UTF8, "application/json"));
        Assert.Equal(HttpStatusCode.Created, resp.StatusCode);
        return (await resp.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("folderId").GetString()!;
    }

    private async Task<List<string?>> FolderIdsAsync(string path)
    {
        var resp = await _client.GetAsync(path);
        resp.EnsureSuccessStatusCode();
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        return body.GetProperty("folders").EnumerateArray()
            .Select(f => f.GetProperty("folderId").GetString())
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
