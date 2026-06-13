using System.Net.Http.Json;
using System.Text;
using System.Text.Json;

namespace Api.Integration;

// RYW-3b end-to-end through the HTTP layer: the folder flows are async (the projector — driven
// in-process by SyncProjectingEventStore — is the sole writer of the folder tree, no inline
// projection write). Each folder write returns its write token in the `X-Consistency-Token`
// response header; `GET /folders` carrying that token in `If-Consistent-With` waits on the gate
// until the projector has applied the write before answering. Mirrors ActionItemReadYourWritesTests.
public sealed class FolderReadYourWritesTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private readonly HttpClient _client = factory.CreateClient();

    [Fact]
    public async Task CreateFolder_ReturnsConsistencyTokenHeader_ForItsStream()
    {
        var (folderId, resp) = await CreateFolderAsync("People");
        var token = Assert.Single(resp.Headers.GetValues("X-Consistency-Token"));
        var (stream, version) = ParseToken(token);

        Assert.Equal($"folder-{Guid.Parse(folderId):N}", stream);
        Assert.True(version >= 1, $"expected a positive version, got {version}");
    }

    [Fact]
    public async Task RenameFolder_ReturnsConsistencyTokenHeader_AtNextVersion()
    {
        var (folderId, createResp) = await CreateFolderAsync("People");
        var (_, createVersion) = ParseToken(createResp.Headers.GetValues("X-Consistency-Token").Single());

        var renameResp = await PatchAsync($"/folders/{folderId}/name", "{\"name\":\"Teams\"}");
        renameResp.EnsureSuccessStatusCode();

        var (stream, version) = ParseToken(renameResp.Headers.GetValues("X-Consistency-Token").Single());
        Assert.Equal($"folder-{Guid.Parse(folderId):N}", stream);
        Assert.Equal(createVersion + 1, version);
    }

    [Fact]
    public async Task GetFolders_WithConsistencyToken_SeesTheNewFolder()
    {
        var (folderId, resp) = await CreateFolderAsync("Read your writes");
        var token = Assert.Single(resp.Headers.GetValues("X-Consistency-Token"));

        var req = new HttpRequestMessage(HttpMethod.Get, "/folders");
        req.Headers.Add("If-Consistent-With", token);
        var getResp = await _client.SendAsync(req);

        getResp.EnsureSuccessStatusCode();
        Assert.False(getResp.Headers.Contains("X-Consistency"));
        var ids = (await getResp.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("folders").EnumerateArray()
            .Select(f => f.GetProperty("folderId").GetString());
        Assert.Contains(folderId, ids);
    }

    // The projector — not an inline write — must DELETE the folder row off the FolderDeleted event.
    [Fact]
    public async Task DeleteFolder_WithConsistencyToken_ProjectorRemovesItFromTheTree()
    {
        var (folderId, _) = await CreateFolderAsync("Doomed");

        var deleteResp = await _client.DeleteAsync($"/folders/{folderId}");
        deleteResp.EnsureSuccessStatusCode();
        var token = Assert.Single(deleteResp.Headers.GetValues("X-Consistency-Token"));

        var req = new HttpRequestMessage(HttpMethod.Get, "/folders");
        req.Headers.Add("If-Consistent-With", token);
        var getResp = await _client.SendAsync(req);

        getResp.EnsureSuccessStatusCode();
        Assert.False(getResp.Headers.Contains("X-Consistency"));
        var ids = (await getResp.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("folders").EnumerateArray()
            .Select(f => f.GetProperty("folderId").GetString());
        Assert.DoesNotContain(folderId, ids);
    }

    [Fact]
    public async Task GetFolders_WithUnreachedToken_ReturnsStaleWithinBound()
    {
        var (folderId, _) = await CreateFolderAsync("People");

        var req = new HttpRequestMessage(HttpMethod.Get, "/folders");
        req.Headers.Add("If-Consistent-With", $"folder-{Guid.Parse(folderId):N}@9999");
        var getResp = await _client.SendAsync(req);

        getResp.EnsureSuccessStatusCode();
        Assert.Equal("stale", Assert.Single(getResp.Headers.GetValues("X-Consistency")));
    }

    private static (string Stream, long Version) ParseToken(string token)
    {
        var at = token.LastIndexOf('@');
        return (token[..at], long.Parse(token[(at + 1)..]));
    }

    private async Task<(string FolderId, HttpResponseMessage Response)> CreateFolderAsync(string name)
    {
        var resp = await _client.PostAsync("/folders",
            new StringContent($"{{\"name\":\"{name}\"}}", Encoding.UTF8, "application/json"));
        resp.EnsureSuccessStatusCode();
        var folderId = (await resp.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("folderId").GetString()!;
        return (folderId, resp);
    }

    private Task<HttpResponseMessage> PatchAsync(string url, string json) =>
        _client.PatchAsync(url, new StringContent(json, Encoding.UTF8, "application/json"));
}
