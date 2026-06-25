using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;

namespace Api.Integration;

// 36-A: a per-workspace theme is set via PATCH /workspaces/{id}/theme and folded into the
// (async) workspace list projection. The write returns its stream's write token in
// X-Consistency-Token; GET /workspaces carrying it in If-Consistent-With waits on the gate so the
// theme is observed read-your-writes.
public sealed class WorkspaceThemeIntegrationTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _factory = factory;
    private readonly HttpClient _client = factory.CreateClient();

    [Fact]
    public async Task SetTheme_ReturnsOkWithToken_AndThemeAppearsInList()
    {
        var id = await CreateWorkspaceAsync("Work");

        var setResp = await _client.PatchAsync($"/workspaces/{id}/theme",
            new StringContent("{\"theme\":\"midnight\"}", Encoding.UTF8, "application/json"));
        Assert.Equal(HttpStatusCode.OK, setResp.StatusCode);
        var token = Assert.Single(setResp.Headers.GetValues("X-Consistency-Token"));

        var req = new HttpRequestMessage(HttpMethod.Get, "/workspaces");
        req.Headers.Add("If-Consistent-With", token);
        var getResp = await _client.SendAsync(req);
        getResp.EnsureSuccessStatusCode();
        Assert.False(getResp.Headers.Contains("X-Consistency"));

        var body = await getResp.Content.ReadFromJsonAsync<JsonElement>();
        var themed = body.GetProperty("workspaces").EnumerateArray()
            .First(w => w.GetProperty("workspaceId").GetString() == id);
        Assert.Equal("midnight", themed.GetProperty("theme").GetString());
    }

    [Fact]
    public async Task SetTheme_OfUnknownWorkspace_ReturnsNotFound()
    {
        var resp = await _client.PatchAsync("/workspaces/does-not-exist/theme",
            new StringContent("{\"theme\":\"midnight\"}", Encoding.UTF8, "application/json"));
        Assert.Equal(HttpStatusCode.NotFound, resp.StatusCode);
    }

    [Fact]
    public async Task SetTheme_OfAnotherUsersWorkspace_ReturnsNotFound()
    {
        var id = await CreateWorkspaceAsync("Mine");

        var otherClient = _factory.CreateClientAsOtherUser();
        var resp = await otherClient.PatchAsync($"/workspaces/{id}/theme",
            new StringContent("{\"theme\":\"midnight\"}", Encoding.UTF8, "application/json"));
        Assert.Equal(HttpStatusCode.NotFound, resp.StatusCode);
    }

    [Fact]
    public async Task SetTheme_WithEmptyTheme_ReturnsBadRequest()
    {
        var id = await CreateWorkspaceAsync("Work");

        var resp = await _client.PatchAsync($"/workspaces/{id}/theme",
            new StringContent("{\"theme\":\"\"}", Encoding.UTF8, "application/json"));
        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
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
