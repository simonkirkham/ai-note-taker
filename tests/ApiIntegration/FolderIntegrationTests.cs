using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;

namespace ApiIntegration;

public sealed class FolderIntegrationTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private readonly HttpClient _client = factory.CreateClient();

    [Fact]
    public async Task PostFolder_ReturnsCreatedWithId()
    {
        var resp = await PostFolderAsync("People", null);
        Assert.Equal(HttpStatusCode.Created, resp.StatusCode);
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        var folderId = body.GetProperty("folderId").GetString();
        Assert.NotNull(folderId);
        Assert.NotEmpty(folderId);
    }

    [Fact]
    public async Task PostFolder_AppearsInGetFolders()
    {
        var resp = await PostFolderAsync("People", null);
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        var folderId = body.GetProperty("folderId").GetString()!;

        var getResp = await _client.GetAsync("/folders");
        getResp.EnsureSuccessStatusCode();
        var getFolders = await getResp.Content.ReadFromJsonAsync<JsonElement>();
        var ids = getFolders.GetProperty("folders").EnumerateArray()
            .Select(f => f.GetProperty("folderId").GetString())
            .ToList();
        Assert.Contains(folderId, ids);
    }

    [Fact]
    public async Task PostFolder_WithParent_AppearsNested()
    {
        var parentResp = await PostFolderAsync("Root", null);
        var parentBody = await parentResp.Content.ReadFromJsonAsync<JsonElement>();
        var parentId = parentBody.GetProperty("folderId").GetString()!;

        var childResp = await PostFolderAsync("Child", parentId);
        var childBody = await childResp.Content.ReadFromJsonAsync<JsonElement>();
        var childId = childBody.GetProperty("folderId").GetString()!;

        var getResp = await _client.GetAsync("/folders");
        getResp.EnsureSuccessStatusCode();
        var getFolders = await getResp.Content.ReadFromJsonAsync<JsonElement>();
        var rootFolders = getFolders.GetProperty("folders").EnumerateArray().ToList();
        var parent = rootFolders.First(f => f.GetProperty("folderId").GetString() == parentId);
        var children = parent.GetProperty("children").EnumerateArray()
            .Select(f => f.GetProperty("folderId").GetString())
            .ToList();
        Assert.Contains(childId, children);
    }

    [Fact]
    public async Task PostFolder_EmptyName_ReturnsBadRequest()
    {
        var resp = await PostFolderAsync("", null);
        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
    }

    [Fact]
    public async Task GetFolders_ReturnsEmptyWhenNoFolders()
    {
        var resp = await _client.GetAsync("/folders");
        resp.EnsureSuccessStatusCode();
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(0, body.GetProperty("folders").GetArrayLength());
    }

    private Task<HttpResponseMessage> PostFolderAsync(string name, string? parentFolderId)
    {
        var payload = parentFolderId is null
            ? $"{{\"name\":\"{name}\"}}"
            : $"{{\"name\":\"{name}\",\"parentFolderId\":\"{parentFolderId}\"}}";
        return _client.PostAsync("/folders",
            new StringContent(payload, Encoding.UTF8, "application/json"));
    }
}
