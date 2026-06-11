using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;

namespace Api.Integration;

[Collection("ProjectionRebuild")]
public sealed class WorkspaceIntegrationTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _factory = factory;
    private readonly HttpClient _client = factory.CreateClient();

    [Fact]
    public async Task Rebuild_RepopulatesWorkspaceList_FromTheEventStream()
    {
        // 23-G AC: ProjectionRebuildHandler must repopulate WorkspaceList from events.
        var id = await CreateWorkspaceAsync("Persisted");
        (await _client.PostAsync("/admin/projections/rebuild", null)).EnsureSuccessStatusCode();

        var getResp = await _client.GetAsync("/workspaces");
        getResp.EnsureSuccessStatusCode();
        var body = await getResp.Content.ReadFromJsonAsync<JsonElement>();
        var ids = body.GetProperty("workspaces").EnumerateArray()
            .Select(w => w.GetProperty("workspaceId").GetString())
            .ToList();
        Assert.Contains("__default__", ids);
        Assert.Contains(id, ids);
    }

    [Fact]
    public async Task PostWorkspace_ReturnsCreatedWithId_AndAppearsInList()
    {
        var id = await CreateWorkspaceAsync("Work");
        Assert.NotEmpty(id);

        var getResp = await _client.GetAsync("/workspaces");
        getResp.EnsureSuccessStatusCode();
        var body = await getResp.Content.ReadFromJsonAsync<JsonElement>();
        var ids = body.GetProperty("workspaces").EnumerateArray()
            .Select(w => w.GetProperty("workspaceId").GetString())
            .ToList();
        Assert.Contains("__default__", ids);
        Assert.Contains(id, ids);
    }

    [Fact]
    public async Task PostWorkspace_EmptyName_ReturnsBadRequest()
    {
        var resp = await _client.PostAsync("/workspaces",
            new StringContent("{\"name\":\"\"}", Encoding.UTF8, "application/json"));
        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
    }

    [Fact]
    public async Task PatchWorkspace_RenamesIt()
    {
        var id = await CreateWorkspaceAsync("Work");

        var renameResp = await _client.PatchAsync($"/workspaces/{id}",
            new StringContent("{\"name\":\"Clients\"}", Encoding.UTF8, "application/json"));
        Assert.Equal(HttpStatusCode.OK, renameResp.StatusCode);

        var body = await (await _client.GetAsync("/workspaces")).Content.ReadFromJsonAsync<JsonElement>();
        var renamed = body.GetProperty("workspaces").EnumerateArray()
            .First(w => w.GetProperty("workspaceId").GetString() == id);
        Assert.Equal("Clients", renamed.GetProperty("name").GetString());
    }

    [Fact]
    public async Task DeleteWorkspace_RemovesItFromList()
    {
        var id = await CreateWorkspaceAsync("Throwaway");

        var deleteResp = await _client.DeleteAsync($"/workspaces/{id}");
        Assert.Equal(HttpStatusCode.NoContent, deleteResp.StatusCode);

        var body = await (await _client.GetAsync("/workspaces")).Content.ReadFromJsonAsync<JsonElement>();
        var ids = body.GetProperty("workspaces").EnumerateArray()
            .Select(w => w.GetProperty("workspaceId").GetString())
            .ToList();
        Assert.DoesNotContain(id, ids);
    }

    [Fact]
    public async Task DeleteDefaultWorkspace_ReturnsConflict()
    {
        var resp = await _client.DeleteAsync("/workspaces/__default__");
        Assert.Equal(HttpStatusCode.Conflict, resp.StatusCode);
    }

    [Fact]
    public async Task RenameWorkspace_OfAnotherUser_ReturnsNotFound()
    {
        var id = await CreateWorkspaceAsync("Mine");

        var otherClient = _factory.CreateClientAsOtherUser();
        var resp = await otherClient.PatchAsync($"/workspaces/{id}",
            new StringContent("{\"name\":\"Hijacked\"}", Encoding.UTF8, "application/json"));
        Assert.Equal(HttpStatusCode.NotFound, resp.StatusCode);
    }

    [Fact]
    public async Task DeleteWorkspace_OfAnotherUser_ReturnsNotFound()
    {
        var id = await CreateWorkspaceAsync("Mine");

        var otherClient = _factory.CreateClientAsOtherUser();
        var resp = await otherClient.DeleteAsync($"/workspaces/{id}");
        Assert.Equal(HttpStatusCode.NotFound, resp.StatusCode);
    }

    private async Task<string> CreateWorkspaceAsync(string name)
    {
        var resp = await _client.PostAsync("/workspaces",
            new StringContent($"{{\"name\":\"{name}\"}}", Encoding.UTF8, "application/json"));
        Assert.Equal(HttpStatusCode.Created, resp.StatusCode);
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        return body.GetProperty("workspaceId").GetString()!;
    }
}

public sealed class WorkspaceEmptyTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private readonly HttpClient _client = factory.CreateClient();

    [Fact]
    public async Task GetWorkspaces_WhenNoneCreated_ReturnsOnlyDefault()
    {
        var resp = await _client.GetAsync("/workspaces");
        resp.EnsureSuccessStatusCode();
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        var workspaces = body.GetProperty("workspaces").EnumerateArray().ToList();
        Assert.Single(workspaces);
        Assert.Equal("__default__", workspaces[0].GetProperty("workspaceId").GetString());
        Assert.True(workspaces[0].GetProperty("isDefault").GetBoolean());
    }
}
