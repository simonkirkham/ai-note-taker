using System.Net.Http.Json;
using System.Text;
using System.Text.Json;

namespace Api.Integration;

// RYW-3b end-to-end through the HTTP layer: the workspace flows are async (the projector — driven
// in-process by SyncProjectingEventStore — is the sole writer of the workspace list, no inline
// projection write). Each workspace write returns its write token in the `X-Consistency-Token`
// response header; `GET /workspaces` carrying that token in `If-Consistent-With` waits on the gate
// until the projector has applied the write before answering. Mirrors FolderReadYourWritesTests.
public sealed class WorkspaceReadYourWritesTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private readonly HttpClient _client = factory.CreateClient();

    [Fact]
    public async Task CreateWorkspace_ReturnsConsistencyTokenHeader_ForItsStream()
    {
        var (workspaceId, resp) = await CreateWorkspaceAsync("Work");
        var token = Assert.Single(resp.Headers.GetValues("X-Consistency-Token"));
        var (stream, version) = ParseToken(token);

        Assert.Equal($"workspace-{workspaceId}", stream);
        Assert.True(version >= 1, $"expected a positive version, got {version}");
    }

    [Fact]
    public async Task GetWorkspaces_WithConsistencyToken_SeesTheNewWorkspace()
    {
        var (workspaceId, resp) = await CreateWorkspaceAsync("Read your writes");
        var token = Assert.Single(resp.Headers.GetValues("X-Consistency-Token"));

        var req = new HttpRequestMessage(HttpMethod.Get, "/workspaces");
        req.Headers.Add("If-Consistent-With", token);
        var getResp = await _client.SendAsync(req);

        getResp.EnsureSuccessStatusCode();
        Assert.False(getResp.Headers.Contains("X-Consistency"));
        var ids = (await getResp.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("workspaces").EnumerateArray()
            .Select(w => w.GetProperty("workspaceId").GetString());
        Assert.Contains(workspaceId, ids);
    }

    // The projector — not an inline write — must DELETE the workspace row off the WorkspaceDeleted event.
    [Fact]
    public async Task DeleteWorkspace_WithConsistencyToken_ProjectorRemovesItFromTheList()
    {
        var (workspaceId, _) = await CreateWorkspaceAsync("Doomed");

        var deleteResp = await _client.DeleteAsync($"/workspaces/{workspaceId}");
        deleteResp.EnsureSuccessStatusCode();
        var token = Assert.Single(deleteResp.Headers.GetValues("X-Consistency-Token"));

        var req = new HttpRequestMessage(HttpMethod.Get, "/workspaces");
        req.Headers.Add("If-Consistent-With", token);
        var getResp = await _client.SendAsync(req);

        getResp.EnsureSuccessStatusCode();
        Assert.False(getResp.Headers.Contains("X-Consistency"));
        var ids = (await getResp.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("workspaces").EnumerateArray()
            .Select(w => w.GetProperty("workspaceId").GetString());
        Assert.DoesNotContain(workspaceId, ids);
    }

    [Fact]
    public async Task GetWorkspaces_WithUnreachedToken_ReturnsStaleWithinBound()
    {
        var (workspaceId, _) = await CreateWorkspaceAsync("Work");

        var req = new HttpRequestMessage(HttpMethod.Get, "/workspaces");
        req.Headers.Add("If-Consistent-With", $"workspace-{workspaceId}@9999");
        var getResp = await _client.SendAsync(req);

        getResp.EnsureSuccessStatusCode();
        Assert.Equal("stale", Assert.Single(getResp.Headers.GetValues("X-Consistency")));
    }

    private static (string Stream, long Version) ParseToken(string token)
    {
        var at = token.LastIndexOf('@');
        return (token[..at], long.Parse(token[(at + 1)..]));
    }

    private async Task<(string WorkspaceId, HttpResponseMessage Response)> CreateWorkspaceAsync(string name)
    {
        var resp = await _client.PostAsync("/workspaces",
            new StringContent($"{{\"name\":\"{name}\"}}", Encoding.UTF8, "application/json"));
        resp.EnsureSuccessStatusCode();
        var workspaceId = (await resp.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("workspaceId").GetString()!;
        return (workspaceId, resp);
    }
}
